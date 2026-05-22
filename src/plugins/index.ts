import type { Logger } from '../logger/index.js';

export interface PluginContext {
  logger: Logger;
  runtime?: unknown;
  compiler?: unknown;
  server?: unknown;
  hmr?: unknown;
  meta?: Record<string, unknown>;
}

export interface ResolveIdContext {
  importer?: string;
  rootDir?: string;
}

export interface LoadContext {
  id: string;
}

export interface TransformContext {
  filePath?: string;
  id?: string;
  framework?: string;
}

export interface HotUpdateContext {
  filePath: string;
  changed: boolean;
  modules?: string[];
  read?: () => Promise<string>;
}

export interface GenerateBundleContext {
  bundle: unknown;
}

export interface FastiumPlugin {
  name: string;
  enforce?: 'pre' | 'post';
  setup?: (context: PluginContext) => void | Promise<void>;
  buildStart?: (context: PluginContext) => void | Promise<void>;
  buildEnd?: (context: PluginContext & { error?: unknown }) => void | Promise<void>;
  resolveId?: (id: string, context: ResolveIdContext) => string | undefined | null | Promise<string | undefined | null>;
  load?: (context: LoadContext) => string | undefined | null | Promise<string | undefined | null>;
  transform?: (source: string, context: TransformContext) => string | void | Promise<string | void>;
  handleHotUpdate?: (context: HotUpdateContext) => void | string[] | Promise<void | string[]>;
  configureServer?: (server: unknown, context: PluginContext) => void | Promise<void>;
  generateBundle?: (context: GenerateBundleContext) => void | Promise<void>;
  dispose?: () => void | Promise<void>;
}

const orderPlugins = (plugins: FastiumPlugin[]): FastiumPlugin[] => [
  ...plugins.filter(plugin => plugin.enforce === 'pre'),
  ...plugins.filter(plugin => plugin.enforce === undefined),
  ...plugins.filter(plugin => plugin.enforce === 'post')
];

export const definePlugin = <T extends FastiumPlugin>(plugin: T): T => plugin;

export const createPluginManager = (plugins: FastiumPlugin[] = []) => {
  const activePlugins = orderPlugins(plugins);
  let context: PluginContext | undefined;

  const withPluginError = async <T>(plugin: FastiumPlugin, hook: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      context?.logger.error(`plugin ${plugin.name} failed in ${hook}`, error);
      throw error;
    }
  };

  return {
    plugins: activePlugins,
    async setup(nextContext: PluginContext): Promise<void> {
      context = nextContext;
      for (const plugin of activePlugins) {
        await withPluginError(plugin, 'setup', async () => plugin.setup?.(nextContext));
      }
    },
    async buildStart(): Promise<void> {
      if (!context) return;
      for (const plugin of activePlugins) {
        await withPluginError(plugin, 'buildStart', async () => plugin.buildStart?.(context as PluginContext));
      }
    },
    async buildEnd(error?: unknown): Promise<void> {
      if (!context) return;
      for (const plugin of [...activePlugins].reverse()) {
        await withPluginError(plugin, 'buildEnd', async () => plugin.buildEnd?.({ ...(context as PluginContext), error }));
      }
    },
    async resolveId(id: string, resolveContext: ResolveIdContext = {}): Promise<string | undefined> {
      for (const plugin of activePlugins) {
        const resolved = await withPluginError(plugin, 'resolveId', async () => plugin.resolveId?.(id, resolveContext));
        if (typeof resolved === 'string') {
          return resolved;
        }
      }
      return undefined;
    },
    async load(id: string): Promise<string | undefined> {
      for (const plugin of activePlugins) {
        const loaded = await withPluginError(plugin, 'load', async () => plugin.load?.({ id }));
        if (typeof loaded === 'string') {
          return loaded;
        }
      }
      return undefined;
    },
    async transform(source: string, transformContext: TransformContext): Promise<string> {
      let output = source;
      for (const plugin of activePlugins) {
        const next = await withPluginError(plugin, 'transform', async () => plugin.transform?.(output, transformContext));
        if (typeof next === 'string') {
          output = next;
        }
      }

      return output;
    },
    async hotUpdate(updateContext: HotUpdateContext): Promise<string[]> {
      const modules = new Set<string>();
      for (const plugin of activePlugins) {
        const result = await withPluginError(plugin, 'handleHotUpdate', async () => plugin.handleHotUpdate?.(updateContext));
        if (Array.isArray(result)) {
          for (const id of result) modules.add(id);
        }
      }
      return Array.from(modules);
    },
    async configureServer(server: unknown): Promise<void> {
      if (!context) return;
      for (const plugin of activePlugins) {
        await withPluginError(plugin, 'configureServer', async () => plugin.configureServer?.(server, context as PluginContext));
      }
    },
    async generateBundle(bundle: unknown): Promise<void> {
      for (const plugin of activePlugins) {
        await withPluginError(plugin, 'generateBundle', async () => plugin.generateBundle?.({ bundle }));
      }
    },
    async dispose(): Promise<void> {
      for (const plugin of [...activePlugins].reverse()) {
        await withPluginError(plugin, 'dispose', async () => plugin.dispose?.());
      }
    }
  };
};
