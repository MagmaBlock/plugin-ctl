import path from "node:path";
import { ensureDir, readYamlFile, writeYamlFile } from "../infra/fs.js";
import type { PendingDeleteOperation, PendingFile, PluginId } from "../types.js";

const PENDING_DIR_NAME = ".pluginctl";
const PENDING_FILE_NAME = "pending.yaml";

function defaultPendingFile(): PendingFile {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    deletes: [],
  };
}

export function pendingFilePath(serverRoot: string): string {
  return path.join(serverRoot, PENDING_DIR_NAME, PENDING_FILE_NAME);
}

export async function readPendingFile(serverRoot: string): Promise<PendingFile> {
  return (await readYamlFile<PendingFile>(pendingFilePath(serverRoot))) ?? defaultPendingFile();
}

export async function writePendingFile(serverRoot: string, pending: PendingFile): Promise<void> {
  const targetPath = pendingFilePath(serverRoot);
  await ensureDir(path.dirname(targetPath));
  await writeYamlFile(targetPath, {
    ...pending,
    updatedAt: new Date().toISOString(),
  });
}

function makeOpId(pluginId: PluginId, fileName: string): string {
  const safeId = pluginId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const safeFile = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `${safeId}-${safeFile}`;
}

export async function enqueuePendingDelete(
  serverRoot: string,
  input: {
    pluginId: PluginId;
    fileName: string;
    reason: string;
  },
): Promise<boolean> {
  const pending = await readPendingFile(serverRoot);
  const opId = makeOpId(input.pluginId, input.fileName);
  const exists = pending.deletes.some((item) => item.opId === opId);
  if (exists) {
    return false;
  }

  const op: PendingDeleteOperation = {
    opId,
    pluginId: input.pluginId,
    fileName: input.fileName,
    requestedAt: new Date().toISOString(),
    reason: input.reason,
    attempts: 0,
  };

  pending.deletes.push(op);
  pending.deletes.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  await writePendingFile(serverRoot, pending);
  return true;
}
