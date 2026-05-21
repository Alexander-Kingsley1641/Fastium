export interface RouteContext {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body?: unknown;
  request?: unknown;
  response?: unknown;
}

export type RouteHandler = (context: RouteContext) => unknown | Promise<unknown>;
export type Middleware = (context: RouteContext, next: () => Promise<void>) => Promise<void> | void;

interface RouteEntry {
  method: string;
  path: string;
  handler: RouteHandler;
  matcher: RegExp;
  keys: string[];
}

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const compilePath = (path: string): { matcher: RegExp; keys: string[] } => {
  const normalized = path === '/' ? '/' : path.replace(/\/+$/u, '');
  if (normalized === '/') {
    return { matcher: /^\/$/, keys: [] };
  }

  const keys: string[] = [];
  const pattern = normalized
    .split('/')
    .filter(Boolean)
    .map(segment => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }

      if (segment === '*') {
        keys.push('wildcard');
        return '(.*)';
      }

      return escapeRegex(segment);
    })
    .join('/');

  return { matcher: new RegExp(`^/${pattern}$`), keys };
};

const normalizePath = (path: string): string => {
  try {
    return new URL(path, 'http://localhost').pathname || '/';
  } catch {
    return path || '/';
  }
};

export const createRouter = () => {
  const routes: RouteEntry[] = [];
  const middleware: Middleware[] = [];

  const register = (method: string, path: string, handler: RouteHandler) => {
    const compiled = compilePath(path);
    routes.push({ method, path, handler, matcher: compiled.matcher, keys: compiled.keys });
  };

  const resolve = (method: string, path: string) => {
    const normalizedPath = normalizePath(path);
    const route = routes.find(entry => entry.method === method.toUpperCase() && entry.matcher.test(normalizedPath));
    if (!route) {
      return undefined;
    }

    const match = normalizedPath.match(route.matcher);
    const params: Record<string, string> = {};
    if (match) {
      route.keys.forEach((key, index) => {
        params[key] = match[index + 1] ?? '';
      });
    }

    return {
      route,
      params,
      query: new URL(path, 'http://localhost').searchParams
    };
  };

  const handle = async (context: RouteContext): Promise<unknown> => {
    let middlewareIndex = -1;

    const runMiddleware = async (): Promise<void> => {
      middlewareIndex += 1;
      const current = middleware[middlewareIndex];
      if (!current) {
        return;
      }

      await current(context, runMiddleware);
    };

    await runMiddleware();
    const match = resolve(context.method, context.path);
    if (!match) {
      return undefined;
    }

    return match.route.handler({ ...context, params: match.params, query: match.query });
  };

  return {
    use(pathOrMiddleware: string | Middleware, maybeMiddleware?: Middleware) {
      if (typeof pathOrMiddleware === 'string') {
        const basePath = pathOrMiddleware;
        const middlewareHandler = maybeMiddleware;
        if (middlewareHandler) {
          middleware.push(async (context, next) => {
            if (context.path.startsWith(basePath)) {
              await middlewareHandler(context, next);
              return;
            }

            await next();
          });
        }
        return;
      }

      middleware.push(pathOrMiddleware);
    },
    route(path: string, handler: RouteHandler, method = 'GET') {
      register(method.toUpperCase(), path, handler);
    },
    get(path: string, handler: RouteHandler) {
      register('GET', path, handler);
    },
    post(path: string, handler: RouteHandler) {
      register('POST', path, handler);
    },
    put(path: string, handler: RouteHandler) {
      register('PUT', path, handler);
    },
    patch(path: string, handler: RouteHandler) {
      register('PATCH', path, handler);
    },
    delete(path: string, handler: RouteHandler) {
      register('DELETE', path, handler);
    },
    resolve,
    handle,
    listRoutes: () => routes.map(route => ({ method: route.method, path: route.path }))
  };
};