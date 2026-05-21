import type { PluginContainer, PluginDefinition, PluginRuntimeContext } from '@alexium/types';

const normalizePlugins = (plugins: readonly PluginDefinition[]): PluginDefinition[] => {
  const seen = new Set<string>();
  const ordered: PluginDefinition[] = [];

  for (const plugin of plugins) {
    if (seen.has(plugin.name)) {
      continue;
    }

    seen.add(plugin.name);
    ordered.push(plugin);
  }

  return ordered;
};

export const definePlugin = (plugin: PluginDefinition): PluginDefinition => plugin;

export const createPluginContainer = (plugins: readonly PluginDefinition[] = []): PluginContainer => {
  const ordered = normalizePlugins(plugins);
  const contextState = new Map<string, unknown>();
  const container: PluginContainer = {
    plugins: ordered,
    use(plugin) {
      return createPluginContainer([...ordered, plugin]);
    },
    async setup(context: PluginRuntimeContext) {
      for (const plugin of ordered) {
        await plugin.setup?.(context);
        for (const command of plugin.commands ?? []) {
          await plugin.onCommand?.(command);
        }
      }
      contextState.set('lastSetup', Date.now());
    },
    async transform(code: string, id: string) {
      let current = code;
      for (const plugin of ordered) {
        if (plugin.transform) {
          current = await plugin.transform(current, id);
        }
      }
      return current;
    }
  };

  return container;
};

export const composePlugins = (...plugins: readonly PluginDefinition[]) => createPluginContainer(plugins);

export const pluginCommand = (name: string, action: (args: readonly string[]) => Promise<void> | void, description?: string) => ({
  name,
  description,
  action
});
