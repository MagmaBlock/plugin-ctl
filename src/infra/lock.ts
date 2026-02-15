import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs.js";

export async function withFileLock<T>(lockFilePath: string, action: () => Promise<T>): Promise<T> {
  await ensureDir(path.dirname(lockFilePath));
  const lockFd = await fs.open(lockFilePath, "wx");
  try {
    await lockFd.writeFile(String(process.pid));
    return await action();
  } finally {
    await lockFd.close();
    await fs.unlink(lockFilePath).catch(() => undefined);
  }
}
