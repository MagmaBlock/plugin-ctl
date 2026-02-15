import { promises as fs } from "node:fs";
import path from "node:path";
import { buildServerPlan } from "./planner.js";
import { applyServerPlan } from "./apply.js";
import { reconcileServerPendingDeletes } from "./maintenance.js";
import type { ReconcileServerResult } from "./maintenance.js";
import { parsePluginId } from "../providers/base.js";
import type { ProviderRegistry } from "../providers/base.js";
import { findCatalogEntry, readCatalog, upsertCatalogEntry, writeCatalog } from "../storage/catalog.js";
import { listServerProfiles, readServerProfile, writeServerProfile } from "../storage/server.js";
import type {
  CatalogEntry,
  DesiredPlugin,
  PlanFile,
  PluginId,
  ServerPlan,
  ServerProfile,
  WorkspaceContext,
} from "../types.js";
import { UserError } from "../infra/errors.js";

export async function ensureServerPluginsDir(profile: ServerProfile): Promise<void> {
  await fs.mkdir(path.join(profile.path, "plugins"), { recursive: true });
}

export function parseDesiredPlugin(pluginId: PluginId, version?: string): DesiredPlugin {
  if (version) {
    return {
      pluginId,
      versionPolicy: "pinned",
      pinnedVersion: version,
      allowPrerelease: false,
    };
  }
  return {
    pluginId,
    versionPolicy: "latest-stable",
    allowPrerelease: false,
  };
}

export async function buildPlansForServer(
  context: WorkspaceContext,
  providers: Pick<ProviderRegistry, "get">,
  serverId: string,
  desiredOverride?: DesiredPlugin[],
): Promise<ServerPlan> {
  const profile = await readServerProfile(context, serverId);
  if (!profile) {
    throw new UserError(`Server ${serverId} not found`);
  }
  const catalog = await readCatalog(context);
  return buildServerPlan(context, profile, catalog, providers, {
    desiredPlugins: desiredOverride,
  });
}

export async function buildPlansForAllServers(
  context: WorkspaceContext,
  providers: Pick<ProviderRegistry, "get">,
): Promise<ServerPlan[]> {
  const serverFiles = await fs.readdir(context.paths.serversDir).catch(() => []);
  const serverIds = serverFiles
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => name.slice(0, -".yaml".length))
    .sort();

  const plans: ServerPlan[] = [];
  for (const serverId of serverIds) {
    plans.push(await buildPlansForServer(context, providers, serverId));
  }
  return plans;
}

export async function applyPlans(
  context: WorkspaceContext,
  plans: ServerPlan[],
  confirmed: boolean,
): Promise<{ warnings: string[]; applied: number }> {
  const warnings: string[] = [];
  let applied = 0;
  for (const plan of plans) {
    const result = await applyServerPlan(context, plan, confirmed);
    warnings.push(...result.warnings);
    applied += result.applied;
  }
  return { warnings, applied };
}

export function mutateDesiredPlugins(
  profile: ServerProfile,
  mutate: (plugins: DesiredPlugin[]) => DesiredPlugin[],
): ServerProfile {
  return {
    ...profile,
    plugins: mutate([...profile.plugins]),
  };
}

export async function updateCatalogFromSourceRef(
  context: WorkspaceContext,
  providers: Pick<ProviderRegistry, "get">,
  sourceRef: string,
  alias?: string,
): Promise<CatalogEntry> {
  const { source, nativeId } = parsePluginId(sourceRef);
  const provider = providers.get(source);
  const meta = await provider.getMetadata(nativeId);
  const catalog = await readCatalog(context);
  const existing = findCatalogEntry(catalog, sourceRef as PluginId);

  const entry: CatalogEntry = {
    pluginId: sourceRef as PluginId,
    name: meta.name,
    source,
    upstreamRef: nativeId,
    defaultChannel: "stable",
    aliases: Array.from(new Set([...(existing?.aliases ?? []), ...(alias ? [alias] : [])])),
  };

  await writeCatalog(context, upsertCatalogEntry(catalog, entry));
  return entry;
}

export async function updateServerProfile(
  context: WorkspaceContext,
  profile: ServerProfile,
): Promise<void> {
  await ensureServerPluginsDir(profile);
  await writeServerProfile(context, profile);
}

export function buildPlanFile(plans: ServerPlan[]): PlanFile {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    plans,
  };
}

export async function reconcileServerMaintenance(
  context: WorkspaceContext,
  serverId: string,
): Promise<ReconcileServerResult> {
  const profile = await readServerProfile(context, serverId);
  if (!profile) {
    throw new UserError(`Server ${serverId} not found`);
  }
  return reconcileServerPendingDeletes(context, profile);
}

export async function reconcileAllServersMaintenance(
  context: WorkspaceContext,
): Promise<ReconcileServerResult[]> {
  const profiles = await listServerProfiles(context);
  const results: ReconcileServerResult[] = [];
  for (const profile of profiles) {
    results.push(await reconcileServerPendingDeletes(context, profile));
  }
  return results;
}
