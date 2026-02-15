import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProviderRegistry } from "../src/providers/index.js";
import { buildServerPlan } from "../src/engine/planner.js";
import { applyServerPlan } from "../src/engine/apply.js";
import { reconcileServerPendingDeletes } from "../src/engine/maintenance.js";
import { ensureWorkspace } from "../src/storage/workspace.js";
import { writeCatalog } from "../src/storage/catalog.js";
import { writeServerProfile } from "../src/storage/server.js";
import { readServerLock, writeServerLock } from "../src/storage/lock.js";
import { readPendingFile } from "../src/storage/pending.js";
import type { CatalogFile, ServerProfile } from "../src/types.js";

describe("integration apply", () => {
  it("stages a manual plugin into plugins/update directory", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-ctl-test-"));
    const serverPath = path.join(tmp, "server1");
    await fs.mkdir(path.join(serverPath, "plugins"), { recursive: true });

    const jarPath = path.join(tmp, "demo.jar");
    await fs.writeFile(jarPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));

    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const context = await ensureWorkspace(tmp);
      const pluginId = `manual:${jarPath}@1.0.0` as const;

      const catalog: CatalogFile = {
        entries: [
          {
            pluginId,
            name: "Demo",
            source: "manual",
            upstreamRef: `${jarPath}@1.0.0`,
            defaultChannel: "stable",
            aliases: [],
          },
        ],
      };
      await writeCatalog(context, catalog);

      const profile: ServerProfile = {
        serverId: "s1",
        path: serverPath,
        mcVersion: "1.21.4",
        flavor: "paper",
        plugins: [
          {
            pluginId,
            versionPolicy: "latest-stable",
            allowPrerelease: false,
          },
        ],
      };

      await writeServerProfile(context, profile);

      const providers = createProviderRegistry();
      const plan = await buildServerPlan(context, profile, catalog, providers);
      expect(plan.changes.length).toBe(1);
      expect(plan.changes[0]?.type).toBe("add");

      const result = await applyServerPlan(context, plan, true);
      expect(result.applied).toBe(1);

      const updateFiles = await fs.readdir(path.join(serverPath, "plugins", "update"));
      expect(updateFiles.some((name) => name.endsWith(".jar"))).toBe(true);

      const lock = await readServerLock(context, "s1");
      expect(lock.plugins.length).toBe(1);
      expect(lock.plugins[0]?.version).toBe("1.0.0");
    } finally {
      process.chdir(cwd);
    }
  });

  it("queues remove operations and applies them during maintenance reconcile", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-ctl-test-"));
    const serverPath = path.join(tmp, "server2");
    await fs.mkdir(path.join(serverPath, "plugins"), { recursive: true });
    await fs.writeFile(path.join(serverPath, "plugins", "old-demo.jar"), Buffer.from([0x50, 0x4b, 0x03, 0x04]));

    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const context = await ensureWorkspace(tmp);
      const pluginId = "manual:old-demo@1.0.0" as const;

      const catalog: CatalogFile = {
        entries: [],
      };
      await writeCatalog(context, catalog);

      const profile: ServerProfile = {
        serverId: "s2",
        path: serverPath,
        mcVersion: "1.21.4",
        flavor: "paper",
        plugins: [],
      };
      await writeServerProfile(context, profile);

      await writeServerLock(context, {
        serverId: "s2",
        updatedAt: new Date().toISOString(),
        plugins: [
          {
            pluginId,
            version: "1.0.0",
            downloadUrl: "file:///tmp/old-demo.jar",
            fileName: "old-demo.jar",
            releaseDate: new Date().toISOString(),
            source: "manual",
          },
        ],
      });

      const providers = createProviderRegistry();
      const plan = await buildServerPlan(context, profile, catalog, providers);
      expect(plan.changes.length).toBe(1);
      expect(plan.changes[0]?.type).toBe("remove");

      await applyServerPlan(context, plan, true);

      const pending = await readPendingFile(serverPath);
      expect(pending.deletes.length).toBe(1);
      expect(pending.deletes[0]?.fileName).toBe("old-demo.jar");

      const reconcile = await reconcileServerPendingDeletes(context, profile);
      expect(reconcile.applied).toBe(1);
      expect(reconcile.remaining).toBe(0);

      const oldExists = await fs
        .access(path.join(serverPath, "plugins", "old-demo.jar"))
        .then(() => true)
        .catch(() => false);
      expect(oldExists).toBe(false);
    } finally {
      process.chdir(cwd);
    }
  });
});
