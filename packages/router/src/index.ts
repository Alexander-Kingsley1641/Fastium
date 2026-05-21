import type { RouterRoute, RouterRuntime } from '@alexium/types';
import { createEventBus } from '@alexium/utils';

const normalizePath = (path: string) => path.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

const compilePattern = (pattern: string) => {
  const keys: string[] = [];
  const source = normalizePath(pattern)
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }

      if (segment === '*') {
        keys.push('wildcard');
        return '(.*)';
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { keys, matcher: new RegExp(`^${source}$`) };
};

export interface RouteRecord extends RouterRoute {
  readonly keys: readonly string[];
  readonly matcher: RegExp;
}

export const createRouter = (routes: readonly RouterRoute[] = []): RouterRuntime & { readonly routes: readonly RouteRecord[]; add(route: RouterRoute): void } => {
  const events = createEventBus<{ navigate: string; preload: string }>();
  const routeRecords: RouteRecord[] = routes.map(route => {
    const compiled = compilePattern(route.path);
    return { ...route, ...compiled };
  });
  let currentPath = typeof window !== 'undefined' ? normalizePath(window.location.pathname) : '/';

  const match = (path: string) => {
    const normalized = normalizePath(path);
    for (const route of routeRecords) {
      const result = route.matcher.exec(normalized);
      if (!result) {
        continue;
      }

      const params = route.keys.reduce<Record<string, string>>((output, key, index) => {
        output[key] = decodeURIComponent(result[index + 1] ?? '');
        return output;
      }, {});

      return { route, params };
    }

    return undefined;
  };

  return {
    routes: routeRecords,
    add(route) {
      routeRecords.push({ ...route, ...compilePattern(route.path) });
    },
    navigate(path) {
      currentPath = normalizePath(path);
      if (typeof window !== 'undefined') {
        window.history.pushState({}, '', currentPath);
      }
      events.emit('navigate', currentPath);
    },
    current() {
      return currentPath;
    },
    match(path) {
      return match(path)?.route;
    },
    async preload(path) {
      const found = match(path);
      events.emit('preload', path);
      return found ? await found.route.load() : undefined;
    }
  };
};

export const defineRoute = (path: string, load: () => Promise<unknown> | unknown): RouterRoute => ({ path, load });
export const resolveRoute = (routes: readonly RouterRoute[], path: string) => createRouter(routes).match(path);
