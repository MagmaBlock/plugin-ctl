import { fetchJson } from "../infra/http.js";
import type {
  ListVersionConstraints,
  PluginMeta,
  PluginProvider,
  PluginVersion,
  SearchResult,
} from "../types.js";
import { buildPluginId } from "./base.js";

interface ModrinthSearchResponse {
  hits: Array<{
    slug: string;
    title: string;
    description?: string;
    project_id?: string;
    latest_version?: string;
  }>;
}

interface ModrinthProject {
  slug: string;
  title: string;
  description?: string;
}

interface ModrinthVersion {
  version_number: string;
  version_type: "release" | "beta" | "alpha";
  date_published: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    url: string;
    filename: string;
    size?: number;
    primary?: boolean;
    hashes?: {
      sha256?: string;
    };
  }>;
}

export class ModrinthProvider implements PluginProvider {
  readonly source = "modrinth" as const;
  private readonly baseUrl = "https://api.modrinth.com/v2";

  async search(query: string): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/search?query=${encodeURIComponent(query)}&limit=10`;
    const data = await fetchJson<ModrinthSearchResponse>(url);
    return data.hits.map((hit) => ({
      pluginId: buildPluginId(this.source, hit.slug),
      name: hit.title,
      source: this.source,
      description: hit.description,
      url: `https://modrinth.com/plugin/${hit.slug}`,
      latestVersion: hit.latest_version,
    }));
  }

  async getMetadata(nativeId: string): Promise<PluginMeta> {
    const data = await fetchJson<ModrinthProject>(`${this.baseUrl}/project/${nativeId}`);
    return {
      pluginId: buildPluginId(this.source, nativeId),
      source: this.source,
      nativeId,
      name: data.title,
      description: data.description,
      url: `https://modrinth.com/plugin/${data.slug ?? nativeId}`,
    };
  }

  async listVersions(nativeId: string, _constraints: ListVersionConstraints): Promise<PluginVersion[]> {
    const data = await fetchJson<ModrinthVersion[]>(`${this.baseUrl}/project/${nativeId}/version`);
    const versions: PluginVersion[] = [];
    for (const item of data) {
      const primary = item.files.find((file) => file.primary) ?? item.files[0];
      if (!primary) {
        continue;
      }
      versions.push({
        pluginId: buildPluginId(this.source, nativeId),
        version: item.version_number,
        channel:
          item.version_type === "release"
            ? "stable"
            : item.version_type === "beta"
              ? "beta"
              : "alpha",
        prerelease: item.version_type !== "release",
        publishedAt: item.date_published,
        mcVersions: item.game_versions,
        loaders: item.loaders,
        download: {
          url: primary.url,
          sha256: primary.hashes?.sha256,
          size: primary.size,
          fileName: primary.filename,
        },
      });
    }
    return versions;
  }
}
