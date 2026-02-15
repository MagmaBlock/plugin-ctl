import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";

export const CURRENT_PACKAGE_NAME = "@magmablock/plugin-ctl";
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_TIMEOUT_MS = 1_500;

export type UpdateChannel = "latest" | "next";

export interface UpdateCheckCache {
  lastCheckedAt?: string;
  latestVersion?: string;
  channel?: UpdateChannel;
  lastNotifiedAt?: string;
  lastNotifiedVersion?: string;
}

export interface UpdateCheckResult {
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  channel: UpdateChannel;
  updateAvailable: boolean;
  checkedFrom: "network" | "cache" | "none";
}

interface RegistryMetadata {
  "dist-tags"?: Record<string, string>;
}

interface BaseOptions {
  packageName?: string;
  cachePath?: string;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RunUpdateCheckNowOptions extends BaseOptions {
  currentVersion?: string;
  ignoreDisable?: boolean;
}

export interface StartBackgroundUpdateCheckOptions extends BaseOptions {
  currentVersion?: string;
  notify?: (message: string) => void;
}

function safeParseTime(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return parsed;
}

export function resolveUpdateCachePath(home = homedir()): string {
  return path.join(home, ".plugin-ctl", "update-check.json");
}

function resolvePackageJsonPath(): string {
  return fileURLToPath(new URL("../../package.json", import.meta.url));
}

export async function readCurrentCliVersion(): Promise<string> {
  const packageJsonPath = resolvePackageJsonPath();
  try {
    const raw = await fs.readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version && parsed.version.trim() ? parsed.version.trim() : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export function selectUpdateChannel(currentVersion: string): UpdateChannel {
  return semver.prerelease(currentVersion) ? "next" : "latest";
}

export function hasNewerVersion(currentVersion: string, latestVersion?: string): boolean {
  if (!latestVersion) {
    return false;
  }
  const current = semver.valid(currentVersion);
  const latest = semver.valid(latestVersion);
  if (!current || !latest) {
    return false;
  }
  return semver.gt(latest, current);
}

export function isCacheExpired(lastCheckedAt: string | undefined, nowMs: number): boolean {
  const checkedAt = safeParseTime(lastCheckedAt);
  if (!checkedAt) {
    return true;
  }
  return nowMs - checkedAt >= UPDATE_CHECK_TTL_MS;
}

export function shouldNotifyUpdate(
  cache: UpdateCheckCache,
  latestVersion: string,
  nowMs: number,
): boolean {
  if (cache.lastNotifiedVersion !== latestVersion) {
    return true;
  }
  const lastNotifiedAt = safeParseTime(cache.lastNotifiedAt);
  if (!lastNotifiedAt) {
    return true;
  }
  return nowMs - lastNotifiedAt >= UPDATE_CHECK_TTL_MS;
}

export function isUpdateCheckDisabled(env = process.env): boolean {
  if (env.PLUGIN_CTL_DISABLE_UPDATE_CHECK === "1") {
    return true;
  }
  if (env.CI && env.CI !== "false" && env.CI !== "0") {
    return true;
  }
  return false;
}

export function formatUpdateMessage(currentVersion: string, latestVersion: string): string {
  return [
    `A new version is available: ${currentVersion} -> ${latestVersion}`,
    `Upgrade: npm i -g ${CURRENT_PACKAGE_NAME}@latest`,
  ].join("\n");
}

async function readCache(cachePath: string): Promise<UpdateCheckCache> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as UpdateCheckCache;
    return parsed ?? {};
  } catch {
    return {};
  }
}

async function writeCache(cachePath: string, cache: UpdateCheckCache): Promise<void> {
  const dir = path.dirname(cachePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(cache, null, 2));
}

async function fetchLatestVersion(
  packageName: string,
  channel: UpdateChannel,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<string | undefined> {
  const encodedName = packageName.replace("/", "%2f");
  const url = `https://registry.npmjs.org/${encodedName}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": `${CURRENT_PACKAGE_NAME}/update-check`,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return undefined;
    }
    const metadata = (await res.json()) as RegistryMetadata;
    const tags = metadata["dist-tags"];
    if (!tags) {
      return undefined;
    }
    const version = tags[channel];
    return version && semver.valid(version) ? version : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runUpdateCheckNow(
  options: RunUpdateCheckNowOptions = {},
): Promise<UpdateCheckResult> {
  const env = options.env ?? process.env;
  const nowMs = options.nowMs ?? Date.now();
  const packageName = options.packageName ?? CURRENT_PACKAGE_NAME;
  const cachePath = options.cachePath ?? resolveUpdateCachePath();
  const currentVersion = options.currentVersion ?? (await readCurrentCliVersion());
  const channel = selectUpdateChannel(currentVersion);
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? UPDATE_CHECK_TIMEOUT_MS;

  if (!options.ignoreDisable && isUpdateCheckDisabled(env)) {
    return {
      packageName,
      currentVersion,
      channel,
      updateAvailable: false,
      checkedFrom: "none",
    };
  }

  const cache = await readCache(cachePath);
  let latestVersion = await fetchLatestVersion(packageName, channel, fetchImpl, timeoutMs);
  let checkedFrom: UpdateCheckResult["checkedFrom"] = "network";

  if (!latestVersion) {
    if (cache.channel === channel && cache.latestVersion) {
      latestVersion = cache.latestVersion;
      checkedFrom = "cache";
    } else {
      checkedFrom = "none";
    }
  }

  const nextCache: UpdateCheckCache = {
    ...cache,
    channel,
    lastCheckedAt: new Date(nowMs).toISOString(),
    latestVersion: latestVersion ?? cache.latestVersion,
  };

  await writeCache(cachePath, nextCache).catch(() => undefined);

  return {
    packageName,
    currentVersion,
    latestVersion,
    channel,
    updateAvailable: hasNewerVersion(currentVersion, latestVersion),
    checkedFrom,
  };
}

export function startBackgroundUpdateCheck(
  options: StartBackgroundUpdateCheckOptions = {},
): void {
  const env = options.env ?? process.env;
  if (isUpdateCheckDisabled(env)) {
    return;
  }

  const nowMs = options.nowMs ?? Date.now();
  const cachePath = options.cachePath ?? resolveUpdateCachePath();
  const packageName = options.packageName ?? CURRENT_PACKAGE_NAME;

  void (async () => {
    const currentVersion = options.currentVersion ?? (await readCurrentCliVersion());
    const channel = selectUpdateChannel(currentVersion);
    let cache = await readCache(cachePath);

    if (
      cache.channel === channel &&
      cache.latestVersion &&
      hasNewerVersion(currentVersion, cache.latestVersion) &&
      shouldNotifyUpdate(cache, cache.latestVersion, nowMs)
    ) {
      const message = formatUpdateMessage(currentVersion, cache.latestVersion);
      (options.notify ?? console.warn)(message);
      await writeCache(cachePath, {
        ...cache,
        lastNotifiedAt: new Date(nowMs).toISOString(),
        lastNotifiedVersion: cache.latestVersion,
      }).catch(() => undefined);
      cache = {
        ...cache,
        lastNotifiedAt: new Date(nowMs).toISOString(),
        lastNotifiedVersion: cache.latestVersion,
      };
    }

    if (!isCacheExpired(cache.lastCheckedAt, nowMs)) {
      return;
    }

    const result = await runUpdateCheckNow({
      packageName,
      cachePath,
      currentVersion,
      env,
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      nowMs,
    });

    if (result.latestVersion && result.updateAvailable && shouldNotifyUpdate(cache, result.latestVersion, nowMs)) {
      const message = formatUpdateMessage(currentVersion, result.latestVersion);
      (options.notify ?? console.warn)(message);
      const refreshedCache = await readCache(cachePath);
      await writeCache(cachePath, {
        ...refreshedCache,
        lastNotifiedAt: new Date(nowMs).toISOString(),
        lastNotifiedVersion: result.latestVersion,
      }).catch(() => undefined);
    }
  })().catch(() => undefined);
}
