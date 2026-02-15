import type { PluginId, PluginProvider, PluginSource } from "../types.js";

export function parsePluginId(pluginId: string): { source: PluginSource; nativeId: string } {
  const idx = pluginId.indexOf(":");
  if (idx <= 0) {
    throw new Error(`Invalid plugin id: ${pluginId}`);
  }
  const source = pluginId.slice(0, idx) as PluginSource;
  const nativeId = pluginId.slice(idx + 1);
  if (!nativeId) {
    throw new Error(`Invalid plugin id: ${pluginId}`);
  }
  return { source, nativeId };
}

export function buildPluginId(source: PluginSource, nativeId: string): PluginId {
  return `${source}:${nativeId}`;
}

export class ProviderRegistry {
  private readonly providers = new Map<PluginSource, PluginProvider>();

  register(provider: PluginProvider): void {
    this.providers.set(provider.source, provider);
  }

  get(source: PluginSource): PluginProvider {
    const provider = this.providers.get(source);
    if (!provider) {
      throw new Error(`Provider not registered for source: ${source}`);
    }
    return provider;
  }

  list(sources?: PluginSource[]): PluginProvider[] {
    if (!sources || sources.length === 0) {
      return [...this.providers.values()];
    }
    return sources.map((source) => this.get(source));
  }
}
