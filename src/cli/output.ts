import type { PlanChange, SearchResult, ServerPlan } from "../types.js";

export interface SearchOutputOptions {
  query: string;
  limit?: number;
  compact?: boolean;
}

function normalizeText(input: string): string {
  return input.trim().toLowerCase();
}

function compactText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncateText(input: string, max = 120): string {
  if (input.length <= max) {
    return input;
  }
  return `${input.slice(0, max - 3)}...`;
}

function rankSearchResult(item: SearchResult, normalizedQuery: string): number {
  const pluginId = normalizeText(item.pluginId);
  const pluginNative = pluginId.split(":").slice(1).join(":");
  const name = normalizeText(item.name);
  const description = normalizeText(item.description ?? "");

  if (!normalizedQuery) {
    return 0;
  }

  let score = 0;
  if (pluginId === normalizedQuery || pluginNative === normalizedQuery) score += 300;
  if (name === normalizedQuery) score += 260;
  if (pluginNative.startsWith(normalizedQuery)) score += 180;
  if (name.startsWith(normalizedQuery)) score += 160;
  if (pluginNative.includes(normalizedQuery)) score += 110;
  if (name.includes(normalizedQuery)) score += 90;
  if (description.includes(normalizedQuery)) score += 25;

  // Slightly favor shorter identifiers when relevance is similar.
  score += Math.max(0, 20 - pluginNative.length);
  return score;
}

function sortAndLimitSearchResults(results: SearchResult[], options: SearchOutputOptions): SearchResult[] {
  const normalizedQuery = normalizeText(options.query);
  const sorted = [...results].sort((left, right) => {
    const scoreDiff = rankSearchResult(right, normalizedQuery) - rankSearchResult(left, normalizedQuery);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return left.pluginId.localeCompare(right.pluginId);
  });

  if (!options.limit || options.limit <= 0) {
    return sorted;
  }
  return sorted.slice(0, options.limit);
}

export function printSearchResults(results: SearchResult[], options: SearchOutputOptions): void {
  if (results.length === 0) {
    console.log("No results.");
    return;
  }

  const limited = sortAndLimitSearchResults(results, options);
  const hiddenCount = results.length - limited.length;
  console.log(
    `Found ${results.length} result(s), showing ${limited.length}${hiddenCount > 0 ? ` (use --limit ${results.length} or --all to show more)` : ""}.`,
  );

  const sourceOrder = ["modrinth", "hangar", "github", "manual"] as const;
  const grouped = new Map<string, SearchResult[]>();
  for (const item of limited) {
    const list = grouped.get(item.source) ?? [];
    list.push(item);
    grouped.set(item.source, list);
  }

  let globalIndex = 1;
  for (const source of sourceOrder) {
    const items = grouped.get(source);
    if (!items || items.length === 0) {
      continue;
    }
    console.log(`\n[${source}] ${items.length} result(s)`);
    for (const item of items) {
      const version = item.latestVersion ? ` | latest=${item.latestVersion}` : "";
      if (options.compact) {
        console.log(`${String(globalIndex).padStart(2, " ")}. ${item.pluginId} | ${item.name}${version}`);
      } else {
        console.log(`${String(globalIndex).padStart(2, " ")}. ${item.pluginId} | ${item.name}${version}`);
        if (item.description) {
          console.log(`    ${truncateText(compactText(item.description))}`);
        }
        if (item.url) {
          console.log(`    ${item.url}`);
        }
      }
      globalIndex += 1;
    }
  }
}

function describeChange(change: PlanChange): string {
  const fromVersion = change.from ? ` ${change.from.version}` : "";
  const toVersion = change.to ? ` ${change.to.version}` : "";

  switch (change.type) {
    case "add":
      return `ADD ${change.pluginId}${toVersion} (${change.reason})`;
    case "remove":
      return `REMOVE ${change.pluginId}${fromVersion} (${change.reason})`;
    case "upgrade":
      return `UPGRADE ${change.pluginId}${fromVersion} ->${toVersion} (${change.reason})`;
    case "downgrade":
      return `DOWNGRADE ${change.pluginId}${fromVersion} ->${toVersion} (${change.reason})`;
    default:
      return `NOOP ${change.pluginId}`;
  }
}

export function printServerPlan(plan: ServerPlan): void {
  console.log(`Plan for server ${plan.serverId} (${plan.serverPath})`);
  if (plan.changes.length === 0) {
    console.log("  No changes.");
    return;
  }

  for (const change of plan.changes) {
    console.log(`  - ${describeChange(change)}`);
  }
}

export function printPlanSummary(plans: ServerPlan[]): void {
  let add = 0;
  let remove = 0;
  let upgrade = 0;
  let downgrade = 0;

  for (const plan of plans) {
    for (const change of plan.changes) {
      if (change.type === "add") add += 1;
      if (change.type === "remove") remove += 1;
      if (change.type === "upgrade") upgrade += 1;
      if (change.type === "downgrade") downgrade += 1;
    }
  }

  console.log(`Summary: add=${add} remove=${remove} upgrade=${upgrade} downgrade=${downgrade}`);
}
