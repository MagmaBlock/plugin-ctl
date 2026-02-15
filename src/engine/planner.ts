import { promises as fs } from "node:fs";
import path from "node:path";
import { buildPlanChanges } from "../domain/diff.js";
import { resolvePluginVersion } from "../domain/resolve.js";
import { UserError } from "../infra/errors.js";
import type { ProviderRegistry } from "../providers/base.js";
import type {
  CatalogFile,
  DesiredPlugin,
  ResolvedPlugin,
  ServerPlan,
  ServerProfile,
  WorkspaceContext,
} from "../types.js";
import { findCatalogEntry } from "../storage/catalog.js";
import { readServerLock } from "../storage/lock.js";

export interface PlanBuildOptions {
  desiredPlugins?: DesiredPlugin[];
}

async function readPluginDirFiles(serverPath: string): Promise<Set<string>> {
  const pluginsDir = path.join(serverPath, "plugins");
  const entries = await fs.readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
  const jarNames = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".jar"))
    .map((entry) => entry.name);
  return new Set(jarNames);
}

export async function buildServerPlan(
  context: WorkspaceContext,
  profile: ServerProfile,
  catalog: CatalogFile,
  providers: Pick<ProviderRegistry, "get">,
  options: PlanBuildOptions = {},
): Promise<ServerPlan> {
  const desired = options.desiredPlugins ?? profile.plugins;
  const lock = await readServerLock(context, profile.serverId);
  const diskFileSet = await readPluginDirFiles(profile.path);

  const resolved: ResolvedPlugin[] = [];
  for (const item of desired) {
    const entry = findCatalogEntry(catalog, item.pluginId);
    if (!entry) {
      throw new UserError(`Plugin ${item.pluginId} is not in catalog`);
    }
    const provider = providers.get(entry.source);

    const resolvedPlugin = await resolvePluginVersion(provider, entry, {
      mcVersion: profile.mcVersion,
      flavor: profile.flavor,
      allowPrerelease: item.allowPrerelease,
      pinnedVersion: item.versionPolicy === "pinned" ? item.pinnedVersion : undefined,
    });

    resolved.push(resolvedPlugin);
  }

  const changes = buildPlanChanges(resolved, lock, diskFileSet);
  return {
    serverId: profile.serverId,
    serverPath: profile.path,
    generatedAt: new Date().toISOString(),
    changes,
  };
}
