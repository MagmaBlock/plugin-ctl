import path from "node:path";
import { exists } from "../infra/fs.js";
import type {
  ListVersionConstraints,
  PluginMeta,
  PluginProvider,
  PluginVersion,
  SearchResult,
} from "../types.js";
import { buildPluginId } from "./base.js";

function parseManualRef(nativeId: string): { ref: string; version: string } {
  const atIndex = nativeId.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      ref: nativeId.slice(0, atIndex),
      version: nativeId.slice(atIndex + 1),
    };
  }
  return {
    ref: nativeId,
    version: "manual",
  };
}

function guessName(ref: string): string {
  try {
    const url = new URL(ref);
    return path.basename(url.pathname);
  } catch {
    return path.basename(ref);
  }
}

export class ManualProvider implements PluginProvider {
  readonly source = "manual" as const;

  async search(_query: string): Promise<SearchResult[]> {
    return [];
  }

  async getMetadata(nativeId: string): Promise<PluginMeta> {
    const { ref } = parseManualRef(nativeId);
    return {
      pluginId: buildPluginId(this.source, nativeId),
      source: this.source,
      nativeId,
      name: guessName(ref) || nativeId,
      description: "Manually managed plugin source",
      url: ref.startsWith("http://") || ref.startsWith("https://") ? ref : undefined,
    };
  }

  async listVersions(nativeId: string, _constraints: ListVersionConstraints): Promise<PluginVersion[]> {
    const { ref, version } = parseManualRef(nativeId);
    let downloadUrl = ref;

    if (!ref.startsWith("http://") && !ref.startsWith("https://") && !ref.startsWith("file://")) {
      const absolute = path.resolve(ref);
      if (!(await exists(absolute))) {
        throw new Error(`Manual source file not found: ${absolute}`);
      }
      downloadUrl = `file://${absolute}`;
    }

    return [
      {
        pluginId: buildPluginId(this.source, nativeId),
        version,
        channel: "stable",
        prerelease: false,
        publishedAt: new Date().toISOString(),
        download: {
          url: downloadUrl,
          fileName: guessName(ref) || `manual-${Date.now()}.jar`,
        },
      },
    ];
  }
}
