#!/usr/bin/env node
import { Command } from "commander";
import {
  applyPlans,
  buildPlanFile,
  buildPlansForAllServers,
  buildPlansForServer,
  mutateDesiredPlugins,
  parseDesiredPlugin,
  reconcileAllServersMaintenance,
  reconcileServerMaintenance,
  updateCatalogFromSourceRef,
  updateServerProfile,
} from "./engine/service.js";
import { printPlanSummary, printSearchResults, printServerPlan } from "./cli/output.js";
import { confirmAction } from "./cli/prompt.js";
import { runDoctor } from "./cli/doctor.js";
import { createProviderRegistry } from "./providers/index.js";
import { parsePluginId } from "./providers/base.js";
import type {
  CatalogEntry,
  DesiredPlugin,
  PluginId,
  PluginSource,
  SearchResult,
  ServerPlan,
  ServerProfile,
} from "./types.js";
import { ensureWorkspace, loadWorkspace } from "./storage/workspace.js";
import { readCatalog } from "./storage/catalog.js";
import { deleteServerLock } from "./storage/lock.js";
import { readPlanFile, writePlanFile } from "./storage/plan.js";
import { deleteServerProfile, listServerProfiles, readServerProfile } from "./storage/server.js";
import { UserError } from "./infra/errors.js";
import {
  CURRENT_PACKAGE_NAME,
  formatUpdateMessage,
  runUpdateCheckNow,
  startBackgroundUpdateCheck,
} from "./infra/update-check.js";

const providers = createProviderRegistry();
const DEFAULT_SEARCH_SOURCES: PluginSource[] = ["modrinth", "hangar"];

function parseSourceList(from?: string): PluginSource[] | undefined {
  if (!from) {
    return DEFAULT_SEARCH_SOURCES;
  }
  return from
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean) as PluginSource[];
}

function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new UserError(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function ensurePluginId(value: string): PluginId {
  parsePluginId(value);
  return value as PluginId;
}

function printCatalog(entries: CatalogEntry[]): void {
  if (entries.length === 0) {
    console.log("Catalog is empty.");
    return;
  }
  for (const entry of entries) {
    const aliasText = entry.aliases.length > 0 ? ` aliases=[${entry.aliases.join(",")}]` : "";
    console.log(`- ${entry.pluginId} | ${entry.name}${aliasText}`);
    console.log(`  ref=${entry.upstreamRef} channel=${entry.defaultChannel}`);
  }
}

function printServers(profiles: ServerProfile[]): void {
  if (profiles.length === 0) {
    console.log("No servers configured.");
    return;
  }
  for (const profile of profiles) {
    console.log(
      `- ${profile.serverId} | path=${profile.path} mc=${profile.mcVersion} flavor=${profile.flavor} plugins=${profile.plugins.length}`,
    );
  }
}

async function withMutatedServerPlugins(
  serverId: string,
  mutateFn: (plugins: DesiredPlugin[]) => DesiredPlugin[],
  options: { yes?: boolean },
): Promise<void> {
  const context = await ensureWorkspace();
  const profile = await readServerProfile(context, serverId);
  if (!profile) {
    throw new UserError(`Server ${serverId} not found`);
  }

  const updatedProfile = mutateDesiredPlugins(profile, mutateFn);
  const plan = await buildPlansForServer(context, providers, serverId, updatedProfile.plugins);
  printServerPlan(plan);
  printPlanSummary([plan]);

  const confirmed = await confirmAction("Apply these changes?", options.yes ?? false);
  if (!confirmed) {
    console.log("Cancelled. No changes applied.");
    return;
  }

  await updateServerProfile(context, updatedProfile);
  const result = await applyPlans(context, [plan], true);

  console.log(`Applied ${result.applied} change(s).`);
  for (const warning of result.warnings) {
    console.log(`WARN: ${warning}`);
  }
}

const program = new Command();
program.name("plugin-ctl").description("Manage plugins across multiple Paper/Spigot servers").version("0.1.0");

program
  .command("source")
  .description("Manage plugin sources")
  .command("search")
  .description("Search plugins from configured providers")
  .argument("<keyword>", "Search keyword")
  .option(
    "--from <sources>",
    "Comma-separated sources: modrinth,hangar,github,manual (default: modrinth,hangar)",
  )
  .option("--limit <n>", "Max results to display (default: 10)", parsePositiveInt)
  .option("--all", "Show all matched results")
  .option("--compact", "Compact output (one line per result)")
  .action(async (keyword: string, opts: { from?: string; limit?: number; all?: boolean; compact?: boolean }) => {
    const sources = parseSourceList(opts.from);
    const targets = providers.list(sources);
    const settled = await Promise.allSettled(targets.map((provider) => provider.search(keyword)));

    const flattened = settled
      .filter(
        (item): item is PromiseFulfilledResult<SearchResult[]> => item.status === "fulfilled",
      )
      .flatMap((item) => item.value);

    for (const [index, item] of settled.entries()) {
      if (item.status === "rejected") {
        const providerName = targets[index]?.source ?? "unknown";
        const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
        console.log(`WARN: search provider failed (${providerName}): ${message}`);
      }
    }

    printSearchResults(flattened, {
      query: keyword,
      compact: opts.compact ?? false,
      limit: opts.all ? undefined : (opts.limit ?? 10),
    });
  });

const catalogCmd = program.command("catalog").description("Manage plugin catalog");
catalogCmd
  .command("add")
  .description("Add plugin source reference into catalog")
  .argument("<source-ref>", "Plugin source ref: modrinth:<id>, hangar:<owner/project>, github:<owner/repo>, manual:<path-or-url>")
  .option("--alias <name>", "Alias for quick identification")
  .action(async (sourceRef: string, opts: { alias?: string }) => {
    const context = await ensureWorkspace();
    const entry = await updateCatalogFromSourceRef(context, providers, sourceRef, opts.alias);
    console.log(`Catalog updated: ${entry.pluginId} (${entry.name})`);
  });

catalogCmd.command("list").description("List catalog entries").action(async () => {
  const context = await ensureWorkspace();
  const catalog = await readCatalog(context);
  printCatalog(catalog.entries);
});

const serverCmd = program.command("server").description("Manage server profiles");
serverCmd
  .command("list")
  .description("List server profiles")
  .action(async () => {
    const context = await ensureWorkspace();
    const profiles = await listServerProfiles(context);
    printServers(profiles);
  });

serverCmd
  .command("add")
  .description("Add a server profile")
  .argument("<server-id>", "Server ID")
  .requiredOption("--path <dir>", "Server root directory")
  .requiredOption("--mc <version>", "Minecraft version")
  .requiredOption("--flavor <flavor>", "paper or spigot")
  .action(
    async (
      serverId: string,
      opts: {
        path: string;
        mc: string;
        flavor: "paper" | "spigot";
      },
    ) => {
      const context = await ensureWorkspace();
      if (!["paper", "spigot"].includes(opts.flavor)) {
        throw new UserError("--flavor must be either paper or spigot");
      }
      const profile: ServerProfile = {
        serverId,
        path: opts.path,
        mcVersion: opts.mc,
        flavor: opts.flavor,
        plugins: [],
      };
      await updateServerProfile(context, profile);
      console.log(`Server added: ${serverId}`);
    },
  );

serverCmd
  .command("remove")
  .description("Remove a server profile")
  .argument("<server-id>", "Server ID")
  .option("-y, --yes", "Skip confirmation")
  .action(async (serverId: string, opts: { yes?: boolean }) => {
    const context = await ensureWorkspace();
    const profile = await readServerProfile(context, serverId);
    if (!profile) {
      throw new UserError(`Server ${serverId} not found`);
    }

    const confirmed = await confirmAction(`Remove server profile ${serverId}?`, opts.yes ?? false);
    if (!confirmed) {
      console.log("Cancelled. No changes applied.");
      return;
    }

    await deleteServerProfile(context, serverId);
    await deleteServerLock(context, serverId);
    console.log(`Server removed: ${serverId} (profile + lock metadata only)`);
  });

const pluginCmd = program.command("plugin").description("Manage server plugins");
pluginCmd
  .command("add")
  .description("Add plugin to server and apply immediately")
  .argument("<server-id>", "Server ID")
  .argument("<plugin-id>", "Plugin ID, e.g. modrinth:luckperms")
  .option("--version <version>", "Pin plugin to specific version")
  .option("-y, --yes", "Skip confirmation")
  .action(async (serverId: string, pluginIdRaw: string, opts: { version?: string; yes?: boolean }) => {
    const pluginId = ensurePluginId(pluginIdRaw);
    await withMutatedServerPlugins(
      serverId,
      (plugins) => {
        const desired = parseDesiredPlugin(pluginId, opts.version);
        const others = plugins.filter((item) => item.pluginId !== pluginId);
        others.push(desired);
        return others.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
      },
      opts,
    );
  });

pluginCmd
  .command("remove")
  .description("Remove plugin from server and apply immediately")
  .argument("<server-id>", "Server ID")
  .argument("<plugin-id>", "Plugin ID")
  .option("-y, --yes", "Skip confirmation")
  .action(async (serverId: string, pluginIdRaw: string, opts: { yes?: boolean }) => {
    const pluginId = ensurePluginId(pluginIdRaw);
    await withMutatedServerPlugins(
      serverId,
      (plugins) => plugins.filter((item) => item.pluginId !== pluginId),
      opts,
    );
  });

pluginCmd
  .command("upgrade")
  .description("Upgrade plugin(s) according to desired policy")
  .argument("<server-id>", "Server ID")
  .argument("[plugin-id]", "Plugin ID")
  .option("--all", "Upgrade all plugins")
  .option("-y, --yes", "Skip confirmation")
  .action(
    async (
      serverId: string,
      pluginIdRaw: string | undefined,
      opts: {
        all?: boolean;
        yes?: boolean;
      },
    ) => {
      if (!opts.all && !pluginIdRaw) {
        throw new UserError("Specify <plugin-id> or --all");
      }

      const context = await ensureWorkspace();
      const profile = await readServerProfile(context, serverId);
      if (!profile) {
        throw new UserError(`Server ${serverId} not found`);
      }

      const selected = opts.all ? undefined : ensurePluginId(pluginIdRaw as string);
      const desired = profile.plugins.map((plugin) => {
        if (selected && plugin.pluginId !== selected) {
          return plugin;
        }
        if (plugin.versionPolicy === "pinned") {
          return plugin;
        }
        return {
          ...plugin,
          versionPolicy: "latest-stable" as const,
          allowPrerelease: false,
        };
      });

      const plan = await buildPlansForServer(context, providers, serverId, desired);
      printServerPlan(plan);
      printPlanSummary([plan]);
      const confirmed = await confirmAction("Apply these changes?", opts.yes ?? false);
      if (!confirmed) {
        console.log("Cancelled. No changes applied.");
        return;
      }

      const result = await applyPlans(context, [plan], true);
      console.log(`Applied ${result.applied} change(s).`);
      for (const warning of result.warnings) {
        console.log(`WARN: ${warning}`);
      }
    },
  );

pluginCmd
  .command("sync")
  .description("Sync server plugins to desired state")
  .argument("<server-id>", "Server ID")
  .option("-y, --yes", "Skip confirmation")
  .action(async (serverId: string, opts: { yes?: boolean }) => {
    const context = await ensureWorkspace();
    const plan = await buildPlansForServer(context, providers, serverId);
    printServerPlan(plan);
    printPlanSummary([plan]);
    const confirmed = await confirmAction("Apply these changes?", opts.yes ?? false);
    if (!confirmed) {
      console.log("Cancelled. No changes applied.");
      return;
    }
    const result = await applyPlans(context, [plan], true);
    console.log(`Applied ${result.applied} change(s).`);
    for (const warning of result.warnings) {
      console.log(`WARN: ${warning}`);
    }
  });

program
  .command("plan")
  .description("Generate plan for one or all servers")
  .argument("[server-id]", "Server ID")
  .option("--all-servers", "Plan all configured servers")
  .option("--out <path>", "Optional output path")
  .action(async (serverId: string | undefined, opts: { allServers?: boolean; out?: string }) => {
    const context = await ensureWorkspace();
    let plans: ServerPlan[];

    if (opts.allServers) {
      plans = await buildPlansForAllServers(context, providers);
    } else if (serverId) {
      plans = [await buildPlansForServer(context, providers, serverId)];
    } else {
      throw new UserError("Specify <server-id> or --all-servers");
    }

    for (const plan of plans) {
      printServerPlan(plan);
    }
    printPlanSummary(plans);

    const file = await writePlanFile(context, buildPlanFile(plans), opts.out);
    console.log(`Plan written to ${file}`);
  });

program
  .command("apply")
  .description("Apply a saved plan file")
  .argument("<plan-file>", "Path to plan yaml")
  .option("-y, --yes", "Skip confirmation")
  .action(async (planFilePath: string, opts: { yes?: boolean }) => {
    const context = await ensureWorkspace();
    const planFile = await readPlanFile(planFilePath);

    for (const plan of planFile.plans) {
      printServerPlan(plan);
    }
    printPlanSummary(planFile.plans);

    const confirmed = await confirmAction("Apply this plan file?", opts.yes ?? false);
    if (!confirmed) {
      console.log("Cancelled. No changes applied.");
      return;
    }

    const result = await applyPlans(context, planFile.plans, true);
    console.log(`Applied ${result.applied} change(s).`);
    for (const warning of result.warnings) {
      console.log(`WARN: ${warning}`);
    }
  });

program
  .command("self")
  .description("Self management commands")
  .command("update-check")
  .description("Check for a newer CLI version now")
  .action(async () => {
    const result = await runUpdateCheckNow({ ignoreDisable: true });
    console.log(`Package: ${result.packageName}`);
    console.log(`Current version: ${result.currentVersion}`);
    console.log(`Channel: ${result.channel}`);
    console.log(`Checked from: ${result.checkedFrom}`);
    if (result.latestVersion) {
      console.log(`Latest version: ${result.latestVersion}`);
    } else {
      console.log("Latest version: unknown");
    }

    if (result.updateAvailable && result.latestVersion) {
      console.log(formatUpdateMessage(result.currentVersion, result.latestVersion));
      return;
    }
    console.log("You are up to date.");
  });

program
  .command("maintenance")
  .description("Run maintenance operations")
  .command("reconcile")
  .description("Apply local pending delete queue under each server root")
  .argument("[server-id]", "Server ID")
  .option("--all-servers", "Reconcile all configured servers")
  .action(async (serverId: string | undefined, opts: { allServers?: boolean }) => {
    const context = await ensureWorkspace();
    const results = opts.allServers
      ? await reconcileAllServersMaintenance(context)
      : serverId
        ? [await reconcileServerMaintenance(context, serverId)]
        : (() => {
            throw new UserError("Specify <server-id> or --all-servers");
          })();

    let total = 0;
    let applied = 0;
    let remaining = 0;
    for (const result of results) {
      total += result.total;
      applied += result.applied;
      remaining += result.remaining;
      console.log(
        `[maintenance] ${result.serverId}: total=${result.total} applied=${result.applied} remaining=${result.remaining}`,
      );
      for (const failure of result.failures) {
        console.log(
          `WARN: ${result.serverId} ${failure.pluginId} (${failure.fileName}) failed: ${failure.error}`,
        );
      }
    }
    console.log(`[maintenance] summary: total=${total} applied=${applied} remaining=${remaining}`);
  });

program.command("doctor").description("Run health checks").action(async () => {
  const context = await loadWorkspace();
  await runDoctor(context);
});

program
  .command("init")
  .description("Initialize workspace files")
  .action(async () => {
    const context = await ensureWorkspace();
    console.log(`Initialized workspace in ${context.paths.root}`);
  });

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const isSelfUpdateCheck = argv[0] === "self" && argv[1] === "update-check";
  if (!isSelfUpdateCheck) {
    startBackgroundUpdateCheck({
      packageName: CURRENT_PACKAGE_NAME,
      notify: (message) => console.warn(message),
    });
  }

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 2;
      return;
    }
    if (error instanceof Error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    console.error("Unknown error");
    process.exitCode = 1;
  }
}

await main();
