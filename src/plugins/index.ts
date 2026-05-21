import type { Logger } from '../logger/index.js';

export interface PluginContext {
  logger: Logger;
  runtime?: unknown;
  compiler?: unknown;
  server?: unknown;
  hmr?: unknown;
}

export interface FastiumPlugin {
  name: string;
  setup?: (context: PluginContext) => void | Promise<void>;
  transform?: (source: string, context: { filePath?: string; framework?: string }) => string | void | Promise<string | void>;
  handleHotUpdate?: (context: { filePath: string; changed: boolean }) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}

export const definePlugin = <T extends FastiumPlugin>(plugin: T): T => plugin;

export const createPluginManager = (plugins: FastiumPlugin[] = []) => {
  const activePlugins = [...plugins];

  return {
    plugins: activePlugins,
    async setup(context: PluginContext): Promise<void> {
      for (const plugin of activePlugins) {
        await plugin.setup?.(context);
      }
    },
    async transform(source: string, context: { filePath?: string; framework?: string }): Promise<string> {
      let output = source;
      for (const plugin of activePlugins) {
        const next = await plugin.transform?.(output, context);
        if (typeof next === 'string') {
          output = next;
        }
      }

      return output;
    },
    async hotUpdate(context: { filePath: string; changed: boolean }): Promise<void> {
      for (const plugin of activePlugins) {
        await plugin.handleHotUpdate?.(context);
      }
    },
    async dispose(): Promise<void> {
      for (const plugin of activePlugins) {
        await plugin.dispose?.();
      }
    }
  };
};