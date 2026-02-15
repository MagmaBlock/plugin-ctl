import semver from "semver";
import type { PluginVersion } from "../types.js";

export function compareVersionStrings(a: string, b: string): number {
  const sa = semver.coerce(a);
  const sb = semver.coerce(b);
  if (sa && sb) {
    return semver.compare(sa, sb);
  }
  return a.localeCompare(b);
}

export function sortVersionsDescending(versions: PluginVersion[]): PluginVersion[] {
  return [...versions].sort((left, right) => {
    const semverCmp = compareVersionStrings(right.version, left.version);
    if (semverCmp !== 0) {
      return semverCmp;
    }
    return new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime();
  });
}
