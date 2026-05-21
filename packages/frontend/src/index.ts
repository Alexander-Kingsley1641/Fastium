import type { AppRuntime, Component, RouterRoute, RouterRuntime, Signal, Store } from '@alexium/types';
import { createPluginContainer } from '@alexium/plugins';
import { createLogger } from '@alexium/logger';
import { createEventBus } from '@alexium/utils';

export interface FrontendAppOptions {
  readonly plugins?: readonly import('@alexium/types').PluginDefinition[];
  readonly logger?: ReturnType<typeof createLogger>;
  readonly routes?: readonly RouterRoute[];
}

const resolveTarget = (target: string | HTMLElement) => {
  if (typeof target !== 'string') {
    return target;
  }

  const element = document.querySelector<HTMLElement>(target);
  if (!element) {
    throw new Error(`Target not found: ${target}`);
  }

  return element;
};

export const createSignal = <T>(initial: T): Signal<T> => {
  let value = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get() {
      return value;
    },
    set(next) {
      value = next;
      for (const listener of listeners) {
        listener(value);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const createStore = <TState extends Record<string, unknown>>(state: TState): Store<TState> => {
  const signal = createSignal(state);
  return {
    getState() {
      return signal.get();
    },
    setState(updater) {
      const current = signal.get();
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      signal.set(next);
    },
    subscribe(listener) {
      return signal.subscribe(listener);
    }
  };
};

export const createRouter = (routes: readonly RouterRoute[] = []): RouterRuntime => {
  const routeList = [...routes];
  const currentPath = createSignal(typeof window !== 'undefined' ? window.location.pathname : '/');
  const bus = createEventBus<{ navigate: string }>();

  return {
    navigate(path) {
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', path);
      }
      currentPath.set(path);
      bus.emit('navigate', path);
    },
    current() {
      return currentPath.get();
    },
    match(path) {
      return routeList.find(route => route.path === path || route.path === '*');
    },
    async preload(path) {
      const route = routeList.find(item => item.path === path);
      return route ? await route.load() : undefined;
    }
  };
};

export const defineComponent = <P>(name: string, render: (props: P) => string | HTMLElement | DocumentFragment): Component<P> => ({
  name,
  render
});

export const createApp = (options: FrontendAppOptions = {}): AppRuntime => {
  const logger = options.logger ?? createLogger({ scope: 'frontend' });
  let pluginContainer = createPluginContainer(options.plugins ?? []);
  const router = createRouter(options.routes ?? []);
  const routeList = [...(options.routes ?? [])];
  const bus = createEventBus<{ mounted: HTMLElement; hydrated: HTMLElement }>();

  const renderRoute = async (target: HTMLElement) => {
    const route = router.match(router.current());
    if (!route) {
      target.innerHTML = '<div>Route not found</div>';
      return;
    }

    const content = await route.load();
    if (typeof content === 'string') {
      target.innerHTML = content;
    } else if (content instanceof HTMLElement || content instanceof DocumentFragment) {
      target.replaceChildren(content);
    } else if (content && typeof content === 'object' && 'render' in content && typeof (content as Component).render === 'function') {
      const rendered = (content as Component).render({});
      if (typeof rendered === 'string') {
        target.innerHTML = rendered;
      } else {
        target.replaceChildren(rendered);
      }
    } else {
      target.innerHTML = `<pre>${JSON.stringify(content, null, 2)}</pre>`;
    }
  };

  const runtime: AppRuntime = {
    async mount(target) {
      if (typeof document === 'undefined') {
        return;
      }

      const element = resolveTarget(target);
      await pluginContainer.setup({ env: {}, logger, bus: createEventBus() });
      await renderRoute(element);
      bus.emit('mounted', element);
    },
    async hydrate(target) {
      if (typeof document === 'undefined') {
        return;
      }

      const element = resolveTarget(target);
      await renderRoute(element);
      bus.emit('hydrated', element);
    },
    use(plugin) {
      pluginContainer = pluginContainer.use(plugin);
      return runtime;
    },
    signal: createSignal,
    store: createStore,
    route(path, load) {
      routeList.push({ path, load });
      return runtime;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('popstate', () => {
      router.navigate(window.location.pathname);
    });
  }

  return runtime;
};

export const lazy = <T>(factory: () => Promise<T>) => ({
  load: factory
});

export const hydrate = async (target: string | HTMLElement, render: () => string | HTMLElement | DocumentFragment) => {
  if (typeof document === 'undefined') {
    return;
  }

  const element = resolveTarget(target);
  const content = render();
  if (typeof content === 'string') {
    element.innerHTML = content;
  } else {
    element.replaceChildren(content);
  }
};

export * from '@alexium/types';
