import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import type { WorkspaceContext } from "../types.js";
import { readCatalog } from "../storage/catalog.js";
import { listServerProfiles } from "../storage/server.js";

export async function runDoctor(context: WorkspaceContext): Promise<number> {
  let issues = 0;

  const profiles = await listServerProfiles(context);
  for (const profile of profiles) {
    const pluginsDir = path.join(profile.path, "plugins");
    const writable = await fs
      .access(pluginsDir, fsConstants.W_OK)
      .then(() => true)
      .catch(() => false);
    if (!writable) {
      console.log(`[doctor] WARN server ${profile.serverId}: plugins dir not writable (${pluginsDir})`);
      issues += 1;
    }

    const files = await fs.readdir(pluginsDir).catch(() => []);
    for (const file of files.filter((name) => name.endsWith(".jar"))) {
      const fullPath = path.join(pluginsDir, file);
      const handle = await fs.open(fullPath, "r").catch(() => undefined);
      if (!handle) {
        continue;
      }
      try {
        const buf = Buffer.alloc(4);
        await handle.read(buf, 0, 4, 0);
        const ok = buf[0] === 0x50 && buf[1] === 0x4b;
        if (!ok) {
          console.log(`[doctor] WARN server ${profile.serverId}: invalid jar signature ${file}`);
          issues += 1;
        }
      } finally {
        await handle.close();
      }
    }
  }

  const catalog = await readCatalog(context);
  const aliasSet = new Set<string>();
  for (const entry of catalog.entries) {
    for (const alias of entry.aliases) {
      const key = alias.toLowerCase();
      if (aliasSet.has(key)) {
        console.log(`[doctor] WARN duplicate alias: ${alias}`);
        issues += 1;
      }
      aliasSet.add(key);
    }
  }

  const checks: Array<{ name: string; url: string }> = [
    { name: "modrinth", url: "https://api.modrinth.com/v2/search?query=luckperms&limit=1" },
    { name: "hangar", url: "https://hangar.papermc.io/api/v1/projects?query=luck&limit=1" },
    { name: "github", url: "https://api.github.com/rate_limit" },
  ];

  for (const check of checks) {
    const ok = await fetch(check.url, { headers: { "user-agent": "plugin-ctl/0.1" } })
      .then((res) => res.ok)
      .catch(() => false);
    if (!ok) {
      console.log(`[doctor] WARN source unavailable: ${check.name}`);
      issues += 1;
    }
  }

  if (issues === 0) {
    console.log("Doctor check passed. No issues found.");
  } else {
    console.log(`Doctor finished with ${issues} warning(s).`);
  }

  return issues;
}
