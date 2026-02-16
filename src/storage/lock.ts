import { promises as fs } from "node:fs";
import path from "node:path";
import type { ServerLock, WorkspaceContext } from "../types.js";
import { readYamlFile, writeYamlFile } from "../infra/fs.js";

export function lockPath(context: WorkspaceContext, serverId: string): string {
  return path.join(context.paths.lockDir, `${serverId}.lock.yaml`);
}

export async function readServerLock(context: WorkspaceContext, serverId: string): Promise<ServerLock> {
  return (
    (await readYamlFile<ServerLock>(lockPath(context, serverId))) ?? {
      serverId,
      updatedAt: new Date(0).toISOString(),
      plugins: [],
    }
  );
}

export async function writeServerLock(context: WorkspaceContext, lock: ServerLock): Promise<void> {
  const withTimestamp: ServerLock = {
    ...lock,
    updatedAt: new Date().toISOString(),
  };
  await writeYamlFile(lockPath(context, lock.serverId), withTimestamp);
}

export async function deleteServerLock(context: WorkspaceContext, serverId: string): Promise<void> {
  await fs.unlink(lockPath(context, serverId)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  });
}
