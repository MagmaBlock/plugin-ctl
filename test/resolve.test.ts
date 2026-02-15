import { describe, expect, it } from "vitest";
import { resolvePluginVersion } from "../src/domain/resolve.js";
import type { CatalogEntry, PluginProvider, PluginVersion } from "../src/types.js";

const versions: PluginVersion[] = [
  {
    pluginId: "modrinth:test-plugin",
    version: "1.0.0",
    channel: "stable",
    prerelease: false,
    publishedAt: "2024-01-01T00:00:00.000Z",
    download: { url: "https://example.com/a.jar", sha256: "a", fileName: "a.jar" },
  },
  {
    pluginId: "modrinth:test-plugin",
    version: "1.1.0-beta.1",
    channel: "beta",
    prerelease: true,
    publishedAt: "2024-02-01T00:00:00.000Z",
    download: { url: "https://example.com/b.jar", sha256: "b", fileName: "b.jar" },
  },
  {
    pluginId: "modrinth:test-plugin",
    version: "1.0.1",
    channel: "stable",
    prerelease: false,
    publishedAt: "2024-03-01T00:00:00.000Z",
    download: { url: "https://example.com/c.jar", sha256: "c", fileName: "c.jar" },
  },
];

const provider: PluginProvider = {
  source: "modrinth",
  async search() {
    return [];
  },
  async getMetadata(nativeId) {
    return {
      pluginId: `modrinth:${nativeId}`,
      source: "modrinth",
      nativeId,
      name: nativeId,
    };
  },
  async listVersions() {
    return versions;
  },
};

const entry: CatalogEntry = {
  pluginId: "modrinth:test-plugin",
  name: "Test",
  source: "modrinth",
  upstreamRef: "test-plugin",
  defaultChannel: "stable",
  aliases: [],
};

describe("resolvePluginVersion", () => {
  it("selects latest stable when prerelease is disabled", async () => {
    const result = await resolvePluginVersion(provider, entry, {
      mcVersion: "1.21.4",
      flavor: "paper",
      allowPrerelease: false,
    });
    expect(result.version).toBe("1.0.1");
  });

  it("resolves pinned version", async () => {
    const result = await resolvePluginVersion(provider, entry, {
      mcVersion: "1.21.4",
      flavor: "paper",
      allowPrerelease: true,
      pinnedVersion: "1.0.0",
    });
    expect(result.version).toBe("1.0.0");
  });
});
