import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  hasNewerVersion,
  isCacheExpired,
  readCurrentCliVersion,
  runUpdateCheckNow,
  selectUpdateChannel,
  shouldNotifyUpdate,
  startBackgroundUpdateCheck,
} from "../src/infra/update-check.js";

describe("update-check", () => {
  it("selects channel based on current version", () => {
    expect(selectUpdateChannel("1.2.3")).toBe("latest");
    expect(selectUpdateChannel("1.2.3-next.1")).toBe("next");
  });

  it("handles semver comparison and cache expiration", () => {
    expect(hasNewerVersion("0.1.0", "0.2.0")).toBe(true);
    expect(hasNewerVersion("0.2.0", "0.1.0")).toBe(false);

    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(isCacheExpired("2026-01-01T00:00:00.000Z", now)).toBe(true);
    expect(isCacheExpired("2026-01-01T12:00:00.000Z", now)).toBe(false);
  });

  it("fetches latest dist-tag and reports update", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-ctl-update-test-"));
    const cachePath = path.join(tmp, "update-check.json");

    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          "dist-tags": {
            latest: "9.9.9",
            next: "10.0.0-next.1",
          },
        }),
        { status: 200 },
      );

    const result = await runUpdateCheckNow({
      currentVersion: "0.1.0",
      cachePath,
      fetchImpl,
      env: {},
      packageName: "@magmablock/plugin-ctl",
    });

    expect(result.channel).toBe("latest");
    expect(result.latestVersion).toBe("9.9.9");
    expect(result.updateAvailable).toBe(true);
    expect(result.checkedFrom).toBe("network");
  });

  it("uses prerelease channel and can fall back to cache on network failure", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-ctl-update-test-"));
    const cachePath = path.join(tmp, "update-check.json");

    await fs.writeFile(
      cachePath,
      JSON.stringify({
        channel: "next",
        latestVersion: "2.0.0-next.5",
      }),
    );

    const fetchImpl: typeof fetch = async () => {
      throw new Error("offline");
    };

    const result = await runUpdateCheckNow({
      currentVersion: "2.0.0-next.1",
      cachePath,
      fetchImpl,
      env: {},
      packageName: "@magmablock/plugin-ctl",
    });

    expect(result.channel).toBe("next");
    expect(result.latestVersion).toBe("2.0.0-next.5");
    expect(result.checkedFrom).toBe("cache");
    expect(result.updateAvailable).toBe(true);
  });

  it("does not notify again within 24h for same version", () => {
    const now = Date.parse("2026-01-02T00:00:00.000Z");
    expect(
      shouldNotifyUpdate(
        {
          lastNotifiedVersion: "1.2.0",
          lastNotifiedAt: "2026-01-01T12:00:00.000Z",
        },
        "1.2.0",
        now,
      ),
    ).toBe(false);
  });

  it("background checker is non-blocking when network fails", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-ctl-update-test-"));
    const cachePath = path.join(tmp, "update-check.json");

    startBackgroundUpdateCheck({
      currentVersion: "0.1.0",
      cachePath,
      fetchImpl: async () => {
        throw new Error("offline");
      },
      env: {},
      notify: () => undefined,
    });

    // Give the detached promise a short tick to execute.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(true).toBe(true);
  });

  it("can read current cli version from package metadata", async () => {
    const version = await readCurrentCliVersion();
    expect(version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
