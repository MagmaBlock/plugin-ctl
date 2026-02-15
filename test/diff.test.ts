import { describe, expect, it } from "vitest";
import { buildPlanChanges } from "../src/domain/diff.js";
import type { ResolvedPlugin, ServerLock } from "../src/types.js";

const desired: ResolvedPlugin[] = [
  {
    pluginId: "modrinth:a",
    version: "2.0.0",
    downloadUrl: "https://example.com/a.jar",
    fileName: "a.jar",
    releaseDate: "2025-01-01T00:00:00.000Z",
    source: "modrinth",
    weakChecksum: true,
  },
];

const lock: ServerLock = {
  serverId: "s1",
  updatedAt: "2025-01-01T00:00:00.000Z",
  plugins: [
    {
      pluginId: "modrinth:a",
      version: "1.0.0",
      downloadUrl: "https://example.com/old.jar",
      fileName: "old-a.jar",
      releaseDate: "2024-01-01T00:00:00.000Z",
      source: "modrinth",
    },
    {
      pluginId: "github:b/c",
      version: "1.0.0",
      downloadUrl: "https://example.com/b.jar",
      fileName: "b.jar",
      releaseDate: "2024-01-01T00:00:00.000Z",
      source: "github",
    },
  ],
};

describe("buildPlanChanges", () => {
  it("creates upgrade and remove changes", () => {
    const changes = buildPlanChanges(desired, lock, new Set(["old-a.jar", "b.jar"]));
    expect(changes.map((item) => item.type).sort()).toEqual(["remove", "upgrade"]);
  });
});
