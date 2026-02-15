import { promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceContext } from "../types.js";
import { ensureDir, sanitizeFileNameSegment } from "../infra/fs.js";

export async function moveToTrash(
  context: WorkspaceContext,
  serverId: string,
  pluginId: string,
  sourceFilePath: string,
  keepLatest = 3,
): Promise<void> {
  const pluginTrashDir = path.join(
    context.paths.trashDir,
    sanitizeFileNameSegment(serverId),
    sanitizeFileNameSegment(pluginId),
  );
  await ensureDir(pluginTrashDir);

  const baseName = path.basename(sourceFilePath);
  const target = path.join(
    pluginTrashDir,
    `${new Date().toISOString().replace(/[.:]/g, "-")}-${baseName}`,
  );

  await fs.rename(sourceFilePath, target).catch(async () => {
    await fs.copyFile(sourceFilePath, target);
    await fs.unlink(sourceFilePath).catch(() => undefined);
  });

  const files = (await fs.readdir(pluginTrashDir))
    .map((file) => path.join(pluginTrashDir, file))
    .sort((a, b) => a.localeCompare(b));
  while (files.length > keepLatest) {
    const oldest = files.shift();
    if (oldest) {
      await fs.unlink(oldest).catch(() => undefined);
    }
  }
}
