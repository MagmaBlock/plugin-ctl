import path from "node:path";
import type { CatalogFile, RootConfig, WorkspaceContext } from "../types.js";
import { ensureDir, exists, readYamlFile, writeYamlFile } from "../infra/fs.js";
import { DEFAULT_ROOT_CONFIG, buildWorkspacePaths } from "./layout.js";

export async function loadWorkspace(root = process.cwd()): Promise<WorkspaceContext> {
  const configPath = path.join(root, "pluginctl.yaml");
  const config = ((await readYamlFile<RootConfig>(configPath)) ?? DEFAULT_ROOT_CONFIG) as RootConfig;
  return {
    config,
    paths: buildWorkspacePaths(root, config),
  };
}

export async function ensureWorkspace(root = process.cwd()): Promise<WorkspaceContext> {
  const configPath = path.join(root, "pluginctl.yaml");
  let config = await readYamlFile<RootConfig>(configPath);
  if (!config) {
    config = { ...DEFAULT_ROOT_CONFIG };
    await writeYamlFile(configPath, config);
  }

  const context: WorkspaceContext = {
    config,
    paths: buildWorkspacePaths(root, config),
  };

  await ensureDir(context.paths.serversDir);
  await ensureDir(path.dirname(context.paths.catalogPath));
  await ensureDir(context.paths.lockDir);
  await ensureDir(context.paths.cacheDir);
  await ensureDir(context.paths.trashDir);
  await ensureDir(context.paths.plansDir);

  if (!(await exists(context.paths.catalogPath))) {
    const initialCatalog: CatalogFile = { entries: [] };
    await writeYamlFile(context.paths.catalogPath, initialCatalog);
  }

  return context;
}
