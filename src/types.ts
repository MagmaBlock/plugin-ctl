export type PluginSource = "modrinth" | "hangar" | "github" | "manual";

export type PluginId = `${PluginSource}:${string}`;

export type VersionPolicy = "latest-stable" | "pinned";

export interface RootConfig {
  version: number;
  serversDir: string;
  catalogPath: string;
  lockDir: string;
  cacheDir: string;
  trashDir: string;
}

export interface CatalogEntry {
  pluginId: PluginId;
  name: string;
  source: PluginSource;
  upstreamRef: string;
  defaultChannel: "stable" | "beta" | "alpha";
  aliases: string[];
}

export interface CatalogFile {
  entries: CatalogEntry[];
}

export interface DesiredPlugin {
  pluginId: PluginId;
  versionPolicy: VersionPolicy;
  pinnedVersion?: string;
  allowPrerelease: boolean;
}

export interface ServerProfile {
  serverId: string;
  path: string;
  mcVersion: string;
  flavor: "paper" | "spigot";
  plugins: DesiredPlugin[];
}

export interface LockPlugin {
  pluginId: PluginId;
  version: string;
  downloadUrl: string;
  sha256?: string;
  fileName: string;
  releaseDate: string;
  source: PluginSource;
  weakChecksum?: boolean;
}

export interface ServerLock {
  serverId: string;
  updatedAt: string;
  plugins: LockPlugin[];
}

export interface SearchResult {
  pluginId: PluginId;
  name: string;
  source: PluginSource;
  description?: string;
  url?: string;
  latestVersion?: string;
}

export interface PluginMeta {
  pluginId: PluginId;
  source: PluginSource;
  nativeId: string;
  name: string;
  description?: string;
  url?: string;
}

export interface DownloadInfo {
  url: string;
  sha256?: string;
  size?: number;
  fileName?: string;
}

export interface PluginVersion {
  pluginId: PluginId;
  version: string;
  channel: "stable" | "beta" | "alpha";
  prerelease: boolean;
  publishedAt: string;
  mcVersions?: string[];
  loaders?: string[];
  download: DownloadInfo;
}

export interface ResolveConstraints {
  mcVersion: string;
  flavor: "paper" | "spigot";
  allowPrerelease: boolean;
  pinnedVersion?: string;
}

export interface ResolvedPlugin {
  pluginId: PluginId;
  version: string;
  downloadUrl: string;
  sha256?: string;
  fileName: string;
  releaseDate: string;
  source: PluginSource;
  weakChecksum: boolean;
}

export type PlanChangeType = "add" | "remove" | "upgrade" | "downgrade" | "noop";

export interface PlanChange {
  type: PlanChangeType;
  reason: string;
  pluginId: PluginId;
  from?: LockPlugin;
  to?: ResolvedPlugin;
}

export interface ServerPlan {
  serverId: string;
  serverPath: string;
  generatedAt: string;
  changes: PlanChange[];
}

export interface PlanFile {
  version: number;
  generatedAt: string;
  plans: ServerPlan[];
}

export interface ProviderSearchOptions {
  limit?: number;
}

export interface ListVersionConstraints extends ResolveConstraints {}

export interface PluginProvider {
  source: PluginSource;
  search(query: string, options?: ProviderSearchOptions): Promise<SearchResult[]>;
  getMetadata(nativeId: string): Promise<PluginMeta>;
  listVersions(nativeId: string, constraints: ListVersionConstraints): Promise<PluginVersion[]>;
}

export interface WorkspacePaths {
  root: string;
  configPath: string;
  serversDir: string;
  catalogPath: string;
  lockDir: string;
  cacheDir: string;
  trashDir: string;
  plansDir: string;
}

export interface WorkspaceContext {
  config: RootConfig;
  paths: WorkspacePaths;
}

export interface PendingDeleteOperation {
  opId: string;
  pluginId: PluginId;
  fileName: string;
  requestedAt: string;
  reason: string;
  attempts: number;
  lastTriedAt?: string;
  lastError?: string;
}

export interface PendingFile {
  version: number;
  updatedAt: string;
  deletes: PendingDeleteOperation[];
}
