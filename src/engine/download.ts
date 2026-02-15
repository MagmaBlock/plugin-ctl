import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ResolvedPlugin, WorkspaceContext } from "../types.js";
import { computeSha256, ensureDir } from "../infra/fs.js";

export interface DownloadResult {
  filePath: string;
  sha256: string;
  fromCache: boolean;
}

function cacheFileName(plugin: ResolvedPlugin): string {
  const safeId = plugin.pluginId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeVersion = plugin.version.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${safeId}-${safeVersion}.jar`;
}

async function writeBuffer(targetPath: string, data: Buffer): Promise<void> {
  const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

export async function downloadArtifact(
  context: WorkspaceContext,
  plugin: ResolvedPlugin,
): Promise<DownloadResult> {
  await ensureDir(context.paths.cacheDir);
  const cachePath = path.join(context.paths.cacheDir, cacheFileName(plugin));

  const hasCache = await fs
    .access(cachePath)
    .then(() => true)
    .catch(() => false);
  if (hasCache) {
    const hash = await computeSha256(cachePath);
    if (!plugin.sha256 || plugin.sha256 === hash) {
      return {
        filePath: cachePath,
        sha256: hash,
        fromCache: true,
      };
    }
  }

  if (plugin.downloadUrl.startsWith("file://")) {
    const srcPath = fileURLToPath(plugin.downloadUrl);
    const data = await fs.readFile(srcPath);
    await writeBuffer(cachePath, data);
  } else {
    const res = await fetch(plugin.downloadUrl, {
      headers: {
        "user-agent": "plugin-ctl/0.1",
      },
    });
    if (!res.ok) {
      throw new Error(`Download failed (${res.status}) for ${plugin.downloadUrl}`);
    }
    const arrayBuffer = await res.arrayBuffer();
    await writeBuffer(cachePath, Buffer.from(arrayBuffer));
  }

  const actualHash = await computeSha256(cachePath);
  if (plugin.sha256 && plugin.sha256 !== actualHash) {
    throw new Error(
      `Checksum mismatch for ${plugin.pluginId}@${plugin.version}. expected=${plugin.sha256} actual=${actualHash}`,
    );
  }

  return {
    filePath: cachePath,
    sha256: actualHash,
    fromCache: false,
  };
}
