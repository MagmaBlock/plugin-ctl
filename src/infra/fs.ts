import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function readYamlFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) {
    return undefined;
  }
  const raw = await fs.readFile(filePath, "utf8");
  return YAML.parse(raw) as T;
}

export async function writeYamlFile(filePath: string, value: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const text = YAML.stringify(value, { prettyErrors: true });
  await atomicWriteFile(filePath, text);
}

export async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tmpPath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.writeFile(tmpPath, content);
  await fs.rename(tmpPath, filePath);
}

export async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
  if (!(await exists(filePath))) {
    return undefined;
  }
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

export async function computeSha256(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const file = await fs.readFile(filePath);
  hash.update(file);
  return hash.digest("hex");
}

export function sanitizeFileNameSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export async function copyFileAtomic(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDir(path.dirname(targetPath));
  const tmpPath = `${targetPath}.tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  await fs.copyFile(sourcePath, tmpPath);
  await fs.rename(tmpPath, targetPath);
}

export async function listFiles(dir: string): Promise<string[]> {
  if (!(await exists(dir))) {
    return [];
  }
  return fs.readdir(dir);
}
