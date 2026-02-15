import path from "node:path";
import type { LockPlugin, PlanChange, ServerLock, ServerPlan, WorkspaceContext } from "../types.js";
import { copyFileAtomic, ensureDir } from "../infra/fs.js";
import { withFileLock } from "../infra/lock.js";
import { downloadArtifact } from "./download.js";
import { readServerLock, writeServerLock } from "../storage/lock.js";
import { enqueuePendingDelete } from "../storage/pending.js";

export interface ApplyResult {
  applied: number;
  skipped: number;
  warnings: string[];
}

function toLockPlugin(change: PlanChange, fileNameOverride?: string): LockPlugin {
  if (!change.to) {
    throw new Error(`Missing target for change ${change.pluginId}`);
  }
  return {
    pluginId: change.to.pluginId,
    version: change.to.version,
    downloadUrl: change.to.downloadUrl,
    sha256: change.to.sha256,
    fileName: fileNameOverride ?? change.to.fileName,
    releaseDate: change.to.releaseDate,
    source: change.to.source,
    weakChecksum: change.to.weakChecksum,
  };
}

async function applyChange(
  context: WorkspaceContext,
  plan: ServerPlan,
  lock: ServerLock,
  change: PlanChange,
  warnings: string[],
): Promise<void> {
  const pluginsDir = path.join(plan.serverPath, "plugins");
  const pluginsUpdateDir = path.join(pluginsDir, "update");
  await ensureDir(pluginsDir);
  await ensureDir(pluginsUpdateDir);

  if (change.type === "remove") {
    const from = change.from;
    if (!from) {
      return;
    }
    const queued = await enqueuePendingDelete(plan.serverPath, {
      pluginId: change.pluginId,
      fileName: from.fileName,
      reason: change.reason,
    });
    if (queued) {
      warnings.push(
        `Queued delete for ${change.pluginId} (${from.fileName}). Run maintenance reconcile when server is stopped.`,
      );
    }
    lock.plugins = lock.plugins.filter((item) => item.pluginId !== change.pluginId);
    return;
  }

  if (!change.to) {
    return;
  }

  const download = await downloadArtifact(context, change.to);
  if (change.to.weakChecksum) {
    warnings.push(`Weak checksum: ${change.pluginId}@${change.to.version} (source did not provide sha256)`);
  }

  // Use existing filename for upgrades so restart-time replacement does not create duplicate jars.
  const deployFileName = change.from?.fileName ?? change.to.fileName;
  const stagedTargetFile = path.join(pluginsUpdateDir, deployFileName);
  await copyFileAtomic(download.filePath, stagedTargetFile);
  warnings.push(
    `Staged ${change.pluginId}@${change.to.version} to plugins/update (${deployFileName}). Restart server to apply.`,
  );

  const lockEntry = toLockPlugin(change, deployFileName);
  const remaining = lock.plugins.filter((item) => item.pluginId !== change.pluginId);
  remaining.push(lockEntry);
  remaining.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  lock.plugins = remaining;
}

export async function applyServerPlan(
  context: WorkspaceContext,
  plan: ServerPlan,
  confirm: boolean,
): Promise<ApplyResult> {
  if (!confirm) {
    return {
      applied: 0,
      skipped: plan.changes.length,
      warnings: [],
    };
  }

  const lockFilePath = path.join(context.paths.lockDir, `${plan.serverId}.apply.lock`);
  return withFileLock(lockFilePath, async () => {
    const lock = await readServerLock(context, plan.serverId);
    const actionable = plan.changes.filter((item) => item.type !== "noop");
    const warnings: string[] = [];

    for (const change of actionable) {
      await applyChange(context, plan, lock, change, warnings);
    }

    await writeServerLock(context, lock);
    return {
      applied: actionable.length,
      skipped: plan.changes.length - actionable.length,
      warnings,
    };
  });
}
