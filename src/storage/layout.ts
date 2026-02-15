import path from "node:path";
import type { RootConfig, WorkspacePaths } from "../types.js";

export const DEFAULT_ROOT_CONFIG: RootConfig = {
  version: 1,
  serversDir: "servers",
  catalogPath: ".pluginctl/catalog.yaml",
  lockDir: ".pluginctl/lock",
  cacheDir: ".pluginctl/cache",
  trashDir: ".pluginctl/trash",
};

export function buildWorkspacePaths(root: string, config: RootConfig): WorkspacePaths {
  return {
    root,
    configPath: path.join(root, "pluginctl.yaml"),
    serversDir: path.join(root, config.serversDir),
    catalogPath: path.join(root, config.catalogPath),
    lockDir: path.join(root, config.lockDir),
    cacheDir: path.join(root, config.cacheDir),
    trashDir: path.join(root, config.trashDir),
    plansDir: path.join(root, ".pluginctl/plans"),
  };
}
