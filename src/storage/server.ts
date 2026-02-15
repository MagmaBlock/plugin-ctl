import { promises as fs } from "node:fs";
import path from "node:path";
import type { ServerProfile, WorkspaceContext } from "../types.js";
import { readYamlFile, writeYamlFile } from "../infra/fs.js";

export function serverProfilePath(context: WorkspaceContext, serverId: string): string {
  return path.join(context.paths.serversDir, `${serverId}.yaml`);
}

export async function readServerProfile(
  context: WorkspaceContext,
  serverId: string,
): Promise<ServerProfile | undefined> {
  return readYamlFile<ServerProfile>(serverProfilePath(context, serverId));
}

export async function writeServerProfile(context: WorkspaceContext, profile: ServerProfile): Promise<void> {
  await writeYamlFile(serverProfilePath(context, profile.serverId), profile);
}

export async function listServerProfiles(context: WorkspaceContext): Promise<ServerProfile[]> {
  const entries = await fs.readdir(context.paths.serversDir, { withFileTypes: true }).catch(() => []);
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"));
  const profiles: ServerProfile[] = [];
  for (const file of files) {
    const filePath = path.join(context.paths.serversDir, file.name);
    const profile = await readYamlFile<ServerProfile>(filePath);
    if (profile) {
      profiles.push(profile);
    }
  }
  profiles.sort((a, b) => a.serverId.localeCompare(b.serverId));
  return profiles;
}
