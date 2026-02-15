import { fetchJson } from "../infra/http.js";
import type {
  ListVersionConstraints,
  PluginMeta,
  PluginProvider,
  PluginVersion,
  SearchResult,
} from "../types.js";
import { buildPluginId } from "./base.js";

interface GithubRepoSearch {
  items: Array<{
    full_name: string;
    name: string;
    description?: string;
    html_url: string;
    pushed_at: string;
  }>;
}

interface GithubRepo {
  full_name: string;
  name: string;
  description?: string;
  html_url: string;
}

interface GithubRelease {
  tag_name: string;
  name: string;
  prerelease: boolean;
  published_at: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    size: number;
  }>;
}

function parseRepoRef(nativeId: string): { owner: string; repo: string } {
  const [owner, repo] = nativeId.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GitHub ref: ${nativeId}. Expected owner/repo`);
  }
  return { owner, repo };
}

export class GithubProvider implements PluginProvider {
  readonly source = "github" as const;
  private readonly baseUrl = "https://api.github.com";

  async search(query: string): Promise<SearchResult[]> {
    const url = `${this.baseUrl}/search/repositories?q=${encodeURIComponent(`${query} minecraft plugin`)}&sort=stars&order=desc&per_page=10`;
    const data = await fetchJson<GithubRepoSearch>(url);
    return data.items.map((repo) => ({
      pluginId: buildPluginId(this.source, repo.full_name),
      name: repo.name,
      source: this.source,
      description: repo.description,
      url: repo.html_url,
    }));
  }

  async getMetadata(nativeId: string): Promise<PluginMeta> {
    const { owner, repo } = parseRepoRef(nativeId);
    const data = await fetchJson<GithubRepo>(`${this.baseUrl}/repos/${owner}/${repo}`);
    return {
      pluginId: buildPluginId(this.source, nativeId),
      source: this.source,
      nativeId,
      name: data.name,
      description: data.description,
      url: data.html_url,
    };
  }

  async listVersions(nativeId: string, _constraints: ListVersionConstraints): Promise<PluginVersion[]> {
    const { owner, repo } = parseRepoRef(nativeId);
    const releases = await fetchJson<GithubRelease[]>(`${this.baseUrl}/repos/${owner}/${repo}/releases?per_page=30`);

    const versions: PluginVersion[] = [];
    for (const release of releases) {
      const asset =
        release.assets.find((item) => item.name.toLowerCase().endsWith(".jar")) ?? release.assets[0];
      if (!asset) {
        continue;
      }
      versions.push({
        pluginId: buildPluginId(this.source, nativeId),
        version: release.tag_name || release.name,
        channel: release.prerelease ? "beta" : "stable",
        prerelease: release.prerelease,
        publishedAt: release.published_at,
        download: {
          url: asset.browser_download_url,
          size: asset.size,
          fileName: asset.name,
        },
      });
    }
    return versions;
  }
}
