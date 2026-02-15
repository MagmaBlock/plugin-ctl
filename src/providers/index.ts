import { ProviderRegistry } from "./base.js";
import { GithubProvider } from "./github.js";
import { HangarProvider } from "./hangar.js";
import { ManualProvider } from "./manual.js";
import { ModrinthProvider } from "./modrinth.js";

export function createProviderRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(new ModrinthProvider());
  registry.register(new HangarProvider());
  registry.register(new GithubProvider());
  registry.register(new ManualProvider());
  return registry;
}
