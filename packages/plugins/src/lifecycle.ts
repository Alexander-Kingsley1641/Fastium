import type { PluginDefinition, PluginRuntimeContext } from '@alexium/types';

export const runPluginLifecycle = async (plugins: readonly PluginDefinition[], context: PluginRuntimeContext) => {
  for (const plugin of plugins) {
    await plugin.setup?.(context);
    await plugin.configure?.(context.env);
    await plugin.buildStart?.();
  }
};

export const finishPluginLifecycle = async (plugins: readonly PluginDefinition[]) => {
  for (const plugin of plugins) {
    await plugin.buildEnd?.();
  }
};
