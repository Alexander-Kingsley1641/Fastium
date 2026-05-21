import type { AppRuntime, PluginDefinition, RouterRoute } from '@alexium/types';
import { createLogger } from '@alexium/logger';
import { createPluginContainer } from '@alexium/plugins';
import { createRouter } from '@alexium/router';
import { createSignal, createStore } from '@alexium/state';
import { createEventBus } from '@alexium/utils';

export interface RuntimeOptions {
  readonly logger?: ReturnType<typeof createLogger>;
  readonly plugins?: readonly PluginDefinition[];
  readonly routes?: readonly RouterRoute[];
}

export interface RuntimeContext {
  readonly logger: ReturnType<typeof createLogger>;
  readonly plugins: ReturnType<typeof createPluginContainer>;
  readonly router: ReturnType<typeof createRouter>;
  readonly bus: ReturnType<typeof createEventBus>;
}

export const createRuntime = (options: RuntimeOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'runtime' });
  const plugins = createPluginContainer(options.plugins ?? []);
  const router = createRouter(options.routes ?? []);
  const bus = createEventBus();

  const context: RuntimeContext = { logger, plugins, router, bus };

  const runtime: AppRuntime = {
    async mount(target) {
      if (typeof document === 'undefined') {
        return;
      }

      await plugins.setup({ env: {}, logger, bus });
      const element = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
      if (!element) {
        throw new Error('Runtime target not found');
      }

      const route = router.match(router.current());
      element.innerHTML = route ? `<div data-alexium-route="${route.path}">Alexium runtime ready</div>` : '<div>Alexium runtime ready</div>';
    },
    async hydrate(target) {
      await runtime.mount(target);
    },
    use(plugin) {
      context.plugins.use(plugin);
      return runtime;
    },
    signal: createSignal,
    store: createStore,
    route(path, load) {
      router.add({ path, load });
      return runtime;
    }
  };

  return { runtime, context, router, plugins, bus };
};

export const createBrowserRuntime = (options: RuntimeOptions = {}) => createRuntime(options).runtime;
export const createServerRuntime = (options: RuntimeOptions = {}) => createRuntime(options);
export type { AppRuntime, Signal, Store, PluginDefinition, RouterRoute } from '@alexium/types';

