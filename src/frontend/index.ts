import { createRouter } from '../router/index.js';
import { createSignal as createSignalImpl, createStore as createStoreImpl } from '../state/index.js';
import { isBrowser } from '../utils/browser-ready.js';

export interface ComponentInstance {
  name: string;
  render: (context?: { props?: Record<string, unknown> }) => string | Node | Promise<string | Node>;
}

export interface AppInstance {
  route: (path: string, handler: (context: unknown) => unknown, method?: string) => void;
  get: (path: string, handler: (context: unknown) => unknown) => void;
  post: (path: string, handler: (context: unknown) => unknown) => void;
  put: (path: string, handler: (context: unknown) => unknown) => void;
  patch: (path: string, handler: (context: unknown) => unknown) => void;
  delete: (path: string, handler: (context: unknown) => unknown) => void;
  use: (...middleware: Array<(context: unknown, next: () => Promise<void>) => unknown>) => void;
  resolve: (method: string, path: string) => unknown;
  state: ReturnType<typeof createStoreImpl<Record<string, unknown>>>;
  signals: Map<string, ReturnType<typeof createSignalImpl<unknown>>>;
  signal<T>(name: string, initialValue: T): ReturnType<typeof createSignalImpl<T>>;
  render: typeof renderValue;
  mount: (selector?: string) => Promise<void>;
  hydrate: (selector?: string) => Promise<void>;
}

export const defineComponent = (name: string, render: ComponentInstance['render']): ComponentInstance => ({ name, render });
export const component = defineComponent;

const renderValue = async (value: string | Node | ComponentInstance | undefined): Promise<string> => {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof Node !== 'undefined' && value instanceof Node) {
    const container = document.createElement('div');
    container.appendChild(value.cloneNode(true));
    return container.innerHTML;
  }

  if (typeof (value as ComponentInstance).render === 'function') {
    const rendered = await (value as ComponentInstance).render();
    return renderValue(rendered);
  }

  return String(value);
};

export const createApp = (): AppInstance => {
  const router = createRouter();
  const state = createStoreImpl<Record<string, unknown>>({});
  const signals = new Map<string, ReturnType<typeof createSignalImpl<unknown>>>();

  const mount = async (selector = '#app'): Promise<void> => {
    if (!isBrowser()) {
      return;
    }

    const element = document.querySelector(selector);
    if (!element) {
      return;
    }

    const route = router.resolve('GET', globalThis.location?.pathname ?? '/') ?? router.resolve('GET', '/');
    const resolved = route ? await route.route.handler({ method: 'GET', path: route.route.path, params: route.params, query: route.query }) : undefined;
    element.innerHTML = await renderValue(resolved as string | Node | ComponentInstance | undefined);
  };

  const hydrate = mount;

  return {
    route: (path: string, handler: (context: unknown) => unknown, method = 'GET') => {
      router.route(path, handler as never, method);
    },
    get: (path: string, handler: (context: unknown) => unknown) => {
      router.get(path, handler as never);
    },
    post: (path: string, handler: (context: unknown) => unknown) => {
      router.post(path, handler as never);
    },
    put: (path: string, handler: (context: unknown) => unknown) => {
      router.put(path, handler as never);
    },
    patch: (path: string, handler: (context: unknown) => unknown) => {
      router.patch(path, handler as never);
    },
    delete: (path: string, handler: (context: unknown) => unknown) => {
      router.delete(path, handler as never);
    },
    use: (...middleware: Array<(context: unknown, next: () => Promise<void>) => unknown>) => {
      for (const entry of middleware) {
        router.use(entry as never);
      }
    },
    resolve: (method: string, path: string) => router.resolve(method, path),
    state,
    signals,
    signal<T>(name: string, initialValue: T) {
      const entry = createSignalImpl(initialValue);
      signals.set(name, entry as ReturnType<typeof createSignalImpl<unknown>>);
      return entry;
    },
    render: renderValue,
    mount,
    hydrate
  };
};

export { createSignal } from '../state/index.js';
export { createStore } from '../state/index.js';
export { createRouter } from '../router/index.js';
export type { Signal } from '../state/index.js';