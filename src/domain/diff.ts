import type { PlanChange, ResolvedPlugin, ServerLock } from "../types.js";
import { compareVersionStrings } from "./version.js";

export function buildPlanChanges(
  desiredResolved: ResolvedPlugin[],
  currentLock: ServerLock,
  diskFileSet: Set<string>,
): PlanChange[] {
  const changes: PlanChange[] = [];
  const desiredById = new Map(desiredResolved.map((item) => [item.pluginId, item]));
  const currentById = new Map(currentLock.plugins.map((item) => [item.pluginId, item]));

  for (const desired of desiredResolved) {
    const current = currentById.get(desired.pluginId);
    if (!current) {
      changes.push({
        type: "add",
        reason: "missing-from-lock",
        pluginId: desired.pluginId,
        to: desired,
      });
      continue;
    }

    if (current.version !== desired.version || current.fileName !== desired.fileName) {
      const cmp = compareVersionStrings(current.version, desired.version);
      changes.push({
        type: cmp <= 0 ? "upgrade" : "downgrade",
        reason: "version-drift",
        pluginId: desired.pluginId,
        from: current,
        to: desired,
      });
      continue;
    }

    if (!diskFileSet.has(current.fileName)) {
      changes.push({
        type: "add",
        reason: "missing-on-disk",
        pluginId: desired.pluginId,
        from: current,
        to: desired,
      });
    }
  }

  for (const locked of currentLock.plugins) {
    if (!desiredById.has(locked.pluginId)) {
      changes.push({
        type: "remove",
        reason: "removed-from-desired",
        pluginId: locked.pluginId,
        from: locked,
      });
    }
  }

  return changes.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}
