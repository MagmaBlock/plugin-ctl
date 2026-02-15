import { promises as fs } from "node:fs";
import path from "node:path";
import { withFileLock } from "../infra/lock.js";
import { readPendingFile, writePendingFile } from "../storage/pending.js";
import type { PendingDeleteOperation, ServerProfile, WorkspaceContext } from "../types.js";
import { moveToTrash } from "./trash.js";

export interface ReconcileServerResult {
  serverId: string;
  total: number;
  applied: number;
  remaining: number;
  failures: Array<{ pluginId: string; fileName: string; error: string }>;
}

function isRecoverableFileBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES";
}

async function fileExists(targetPath: string): Promise<boolean> {
  return fs
    .access(targetPath)
    .then(() => true)
    .catch(() => false);
}

export async function reconcileServerPendingDeletes(
  context: WorkspaceContext,
  profile: ServerProfile,
): Promise<ReconcileServerResult> {
  const lockFilePath = path.join(context.paths.lockDir, `${profile.serverId}.maintenance.lock`);
  return withFileLock(lockFilePath, async () => {
    const pending = await readPendingFile(profile.path);
    if (pending.deletes.length === 0) {
      return {
        serverId: profile.serverId,
        total: 0,
        applied: 0,
        remaining: 0,
        failures: [],
      };
    }

    const remainingDeletes: PendingDeleteOperation[] = [];
    const failures: ReconcileServerResult["failures"] = [];
    let applied = 0;

    for (const op of pending.deletes) {
      const pluginPath = path.join(profile.path, "plugins", op.fileName);
      if (!(await fileExists(pluginPath))) {
        applied += 1;
        continue;
      }

      try {
        await moveToTrash(context, profile.serverId, op.pluginId, pluginPath);
        applied += 1;
      } catch (error) {
        const baseMessage = error instanceof Error ? error.message : String(error);
        const message = isRecoverableFileBusyError(error)
          ? `file may still be locked by running server: ${baseMessage}`
          : baseMessage;
        const nextOp: PendingDeleteOperation = {
          ...op,
          attempts: op.attempts + 1,
          lastTriedAt: new Date().toISOString(),
          lastError: message,
        };
        remainingDeletes.push(nextOp);
        failures.push({
          pluginId: op.pluginId,
          fileName: op.fileName,
          error: message,
        });
      }
    }

    await writePendingFile(profile.path, {
      ...pending,
      deletes: remainingDeletes,
    });

    return {
      serverId: profile.serverId,
      total: pending.deletes.length,
      applied,
      remaining: remainingDeletes.length,
      failures,
    };
  });
}
