import { fetchJson } from "../infra/http.js";
import type {
  ListVersionConstraints,
  PluginMeta,
  PluginProvider,
  PluginVersion,
  SearchResult,
} from "../types.js";
import { buildPluginId } from "./base.js";

interface HangarSearchResponse {
  result?: Array<Record<string, unknown>>;
  projects?: Array<Record<string, unknown>>;
}

interface HangarProjectResponse {
  name?: string;
  description?: string;
  namespace?: {
    owner?: string;
  };
  owner?: string;
}

function normalizeProjectRef(nativeId: string): { owner: string; project: string } {
  const [owner, project] = nativeId.split("/");
  if (!owner || !project) {
    throw new Error(`Invalid Hangar ref: ${nativeId}. Expected owner/project`);
  }
  return { owner, project };
}

function pickString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export class HangarProvider implements PluginProvider {
  readonly source = "hangar" as const;
  private readonly baseUrl = "https://hangar.papermc.io/api/v1";

  async search(query: string): Promise<SearchResult[]> {
    const data = await fetchJson<HangarSearchResponse>(
      `${this.baseUrl}/projects?query=${encodeURIComponent(query)}&limit=10`,
    );

    const projects = data.result ?? data.projects ?? [];
    const results: SearchResult[] = [];
    for (const record of projects) {
      const owner =
        pickString(record, ["owner", "namespace", "author"]) ??
        (typeof record.namespace === "object" && record.namespace
          ? pickString(record.namespace as Record<string, unknown>, ["owner", "name"])
          : undefined);
      const project = pickString(record, ["name", "slug"]);
      if (!owner || !project) {
        continue;
      }

      results.push({
        pluginId: buildPluginId(this.source, `${owner}/${project}`),
        name: project,
        source: this.source,
        description: pickString(record, ["description"]),
        url: `https://hangar.papermc.io/${owner}/${project}`,
      });
    }
    return results;
  }

  async getMetadata(nativeId: string): Promise<PluginMeta> {
    const { owner, project } = normalizeProjectRef(nativeId);
    const data = await fetchJson<HangarProjectResponse>(`${this.baseUrl}/projects/${owner}/${project}`);
    return {
      pluginId: buildPluginId(this.source, nativeId),
      source: this.source,
      nativeId,
      name: data.name ?? project,
      description: data.description,
      url: `https://hangar.papermc.io/${owner}/${project}`,
    };
  }

  async listVersions(nativeId: string, constraints: ListVersionConstraints): Promise<PluginVersion[]> {
    const { owner, project } = normalizeProjectRef(nativeId);
    const versions = await fetchJson<Array<Record<string, unknown>>>(
      `${this.baseUrl}/projects/${owner}/${project}/versions`,
    );

    const platform = constraints.flavor === "paper" ? "PAPER" : "SPIGOT";

    const mappedVersions: PluginVersion[] = [];
    for (const versionRecord of versions) {
      const version = pickString(versionRecord, ["name", "version"]);
      if (!version) {
        continue;
      }

      const createdAt =
        pickString(versionRecord, ["createdAt", "created_at", "releaseDate"]) ??
        new Date().toISOString();

      const channel = pickString(versionRecord, ["channel", "releaseChannel"]);
      const channelNormalized =
        channel && /alpha/i.test(channel) ? "alpha" : channel && /beta/i.test(channel) ? "beta" : "stable";

      const mcVersions =
        Array.isArray(versionRecord.platformDependencies) && versionRecord.platformDependencies
          ? (versionRecord.platformDependencies as Array<Record<string, unknown>>)
              .map((item) => pickString(item, ["version"]))
              .filter((item): item is string => Boolean(item))
          : undefined;

      const downloadUrl = `${this.baseUrl}/projects/${owner}/${project}/versions/${encodeURIComponent(version)}/${platform}/download`;

      mappedVersions.push({
        pluginId: buildPluginId(this.source, nativeId),
        version,
        channel: channelNormalized,
        prerelease: channelNormalized !== "stable",
        publishedAt: createdAt,
        mcVersions,
        loaders: [constraints.flavor],
        download: {
          url: downloadUrl,
          fileName: `${project}-${version}.jar`,
        },
      });
    }
    return mappedVersions;
  }
}
