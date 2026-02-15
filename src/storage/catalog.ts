import type { CatalogEntry, CatalogFile, PluginId, WorkspaceContext } from "../types.js";
import { readYamlFile, writeYamlFile } from "../infra/fs.js";

export async function readCatalog(context: WorkspaceContext): Promise<CatalogFile> {
  return (await readYamlFile<CatalogFile>(context.paths.catalogPath)) ?? { entries: [] };
}

export async function writeCatalog(context: WorkspaceContext, catalog: CatalogFile): Promise<void> {
  await writeYamlFile(context.paths.catalogPath, catalog);
}

export function findCatalogEntry(catalog: CatalogFile, pluginId: PluginId): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.pluginId === pluginId);
}

export function upsertCatalogEntry(catalog: CatalogFile, entry: CatalogEntry): CatalogFile {
  const nextEntries = catalog.entries.filter((item) => item.pluginId !== entry.pluginId);
  nextEntries.push(entry);
  nextEntries.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  return { entries: nextEntries };
}
