import type {
  CatalogEntry,
  ListVersionConstraints,
  PluginProvider,
  PluginVersion,
  ResolvedPlugin,
} from "../types.js";
import { UserError } from "../infra/errors.js";
import { sortVersionsDescending } from "./version.js";

function isCompatible(version: PluginVersion, constraints: ListVersionConstraints): boolean {
  if (constraints.allowPrerelease === false && version.prerelease) {
    return false;
  }

  if (version.mcVersions && version.mcVersions.length > 0) {
    const exact = version.mcVersions.includes(constraints.mcVersion);
    const prefix = version.mcVersions.some((item) => constraints.mcVersion.startsWith(item));
    if (!exact && !prefix) {
      return false;
    }
  }

  if (version.loaders && version.loaders.length > 0) {
    const flavorLoader = constraints.flavor === "paper" ? "paper" : "spigot";
    const hasMatch = version.loaders.some((item) => item.toLowerCase().includes(flavorLoader));
    if (!hasMatch) {
      return false;
    }
  }

  return true;
}

export async function resolvePluginVersion(
  provider: PluginProvider,
  entry: CatalogEntry,
  constraints: ListVersionConstraints,
): Promise<ResolvedPlugin> {
  const versions = await provider.listVersions(entry.upstreamRef, constraints);

  const compatible = versions.filter((version) => isCompatible(version, constraints));
  if (compatible.length === 0) {
    throw new UserError(
      `No compatible versions for ${entry.pluginId} on MC ${constraints.mcVersion}/${constraints.flavor}`,
    );
  }

  let selected: PluginVersion | undefined;

  if (constraints.pinnedVersion) {
    selected = compatible.find((version) => version.version === constraints.pinnedVersion);
    if (!selected) {
      throw new UserError(
        `Pinned version ${constraints.pinnedVersion} not found for ${entry.pluginId}`,
      );
    }
  } else {
    selected = sortVersionsDescending(compatible)[0];
  }

  if (!selected) {
    throw new UserError(`Unable to resolve ${entry.pluginId}`);
  }

  return {
    pluginId: entry.pluginId,
    version: selected.version,
    downloadUrl: selected.download.url,
    sha256: selected.download.sha256,
    fileName:
      selected.download.fileName ??
      `${entry.pluginId.replace(/[:/]/g, "-")}-${selected.version}.jar`,
    releaseDate: selected.publishedAt,
    source: entry.source,
    weakChecksum: !selected.download.sha256,
  };
}
