import type { ConfigFile, PluginDefinition, PluginRuntimeContext } from '@alexium/types';
import { createLogger } from '@alexium/logger';
import { composePlugins } from '@alexium/plugins';
import { deepMerge, createEventBus } from '@alexium/utils';

export interface AlexiumInstance {
  readonly config: ConfigFile;
  readonly logger: ReturnType<typeof createLogger>;
  readonly plugins: ReturnType<typeof composePlugins>;
  readonly bus: ReturnType<typeof createEventBus>;
  use(plugin: PluginDefinition): AlexiumInstance;
  configure(config: ConfigFile): AlexiumInstance;
  bootstrap(): Promise<void>;
}

export const createAlexium = (config: ConfigFile = {}): AlexiumInstance => {
  const logger = createLogger({ scope: 'alexium', debug: config.mode !== 'production' });
  let currentConfig = config;
  let pluginContainer = composePlugins(...(config.plugins ?? []));
  const bus = createEventBus();

  const instance: AlexiumInstance = {
    config: currentConfig,
    logger,
    plugins: pluginContainer,
    bus,
    use(plugin) {
      pluginContainer = pluginContainer.use(plugin);
      currentConfig = { ...currentConfig, plugins: [...(currentConfig.plugins ?? []), plugin] };
      return instance;
    },
    configure(nextConfig) {
      currentConfig = deepMerge(currentConfig as Record<string, unknown>, nextConfig as Record<string, unknown>) as ConfigFile;
      return instance;
    },
    async bootstrap() {
      const runtimeContext: PluginRuntimeContext = {
        env: {},
        logger,
        bus
      };

      await pluginContainer.setup(runtimeContext);
    }
  };

  return instance;
};

export * from '@alexium/types';
export * from '@alexium/plugins';
export * from '@alexium/logger';
export * from '@alexium/utils';
