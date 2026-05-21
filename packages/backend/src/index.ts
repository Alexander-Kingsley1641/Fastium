import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Middleware,
  MiddlewareContext,
  RequestContext,
  RouteDefinition,
  RouteHandler,
  ServerOptions,
  ServerRuntime,
  UploadFile
} from '@alexium/types';
import { createLogger } from '@alexium/logger';
import { createEventBus, deepMerge, getPath, randomID, setPath } from '@alexium/utils';
import { createPluginContainer } from '@alexium/plugins';
import { acceptWebSocket } from '@alexium/websocket';

export interface HttpRoute extends RouteDefinition {
  readonly compiled: RegExp;
  readonly keys: readonly string[];
}

export interface BackendRuntime extends ServerRuntime {
  get(path: string, handler: RouteHandler): BackendRuntime;
  post(path: string, handler: RouteHandler): BackendRuntime;
  put(path: string, handler: RouteHandler): BackendRuntime;
  patch(path: string, handler: RouteHandler): BackendRuntime;
  delete(path: string, handler: RouteHandler): BackendRuntime;
  ws(handler: (socket: unknown, request: RequestContext) => void): BackendRuntime;
  upload(request: RequestContext): Promise<{ fields: Record<string, string>; files: UploadFile[] }>;
  config(key: string, fallback?: unknown): unknown;
}

const compilePath = (pattern: string) => {
  const keys: string[] = [];
  const source = pattern
    .split('/')
    .map(segment => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return { compiled: new RegExp(`^${source}$`), keys };
};

const readBody = async (request: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

const parseJSONBody = async (request: http.IncomingMessage) => {
  const body = await readBody(request);
  if (body.length === 0) {
    return undefined;
  }

  const text = body.toString('utf8');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const parseMultipart = (raw: Buffer, boundary: string) => {
  const fields: Record<string, string> = {};
  const files: UploadFile[] = [];
  const delimiter = `--${boundary}`;
  const chunks = raw.toString('binary').split(delimiter).slice(1, -1);

  for (const chunk of chunks) {
    const normalized = chunk.replace(/^\r\n/, '').replace(/\r\n--$/, '');
    const [headerBlock, ...bodyParts] = normalized.split('\r\n\r\n');
    const body = bodyParts.join('\r\n\r\n');
    const nameMatch = /name="([^"]+)"/.exec(headerBlock);
    const fileMatch = /filename="([^"]*)"/.exec(headerBlock);
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerBlock);
    const fieldName = nameMatch?.[1] ?? '';

    if (!fieldName) {
      continue;
    }

    if (fileMatch) {
      files.push({
        filename: fileMatch[1],
        mimeType: typeMatch?.[1] ?? 'application/octet-stream',
        buffer: Buffer.from(body, 'binary')
      });
    } else {
      fields[fieldName] = body.replace(/\r\n$/, '');
    }
  }

  return { fields, files };
};

const sendResponse = (response: http.ServerResponse, payload: unknown, statusCode = 200) => {
  response.statusCode = statusCode;

  if (payload === undefined) {
    response.end();
    return;
  }

  if (typeof payload === 'string' || Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
    response.end(payload);
    return;
  }

  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(payload, null, 2));
};

export const createServer = (options: ServerOptions = {}): BackendRuntime => {
  const logger = options.logger ?? createLogger({ scope: 'backend' });
  const bus = createEventBus();
  const routes: HttpRoute[] = [];
  const middlewares: Middleware[] = [];
  let httpServer: http.Server | undefined;
  let wsHandler: ((socket: import('@alexium/types').WebSocketConnection, request: RequestContext) => void) | undefined;
  const configStore = deepMerge({ port: 3000, host: '127.0.0.1', env: options.env ?? {} }, options as Record<string, unknown>);
  const pluginContainer = createPluginContainer(options.plugins ?? []);

  const runtime: BackendRuntime = {
    routes,
    middlewares,
    logger,
    use(middleware) {
      middlewares.push(middleware);
      return runtime;
    },
    route(method, pattern, handler) {
      const { compiled, keys } = compilePath(pattern);
      routes.push({ method: method.toUpperCase(), path: pattern, handler, compiled, keys });
      return runtime;
    },
    get(path, handler) {
      return runtime.route('GET', path, handler) as BackendRuntime;
    },
    post(path, handler) {
      return runtime.route('POST', path, handler) as BackendRuntime;
    },
    put(path, handler) {
      return runtime.route('PUT', path, handler) as BackendRuntime;
    },
    patch(path, handler) {
      return runtime.route('PATCH', path, handler) as BackendRuntime;
    },
    delete(path, handler) {
      return runtime.route('DELETE', path, handler) as BackendRuntime;
    },
    ws(handler) {
      wsHandler = handler;
      return runtime;
    },
    async upload(request) {
      const contentType = request.request.headers['content-type'] ?? '';
      const [type] = String(contentType).split(';');
      const boundaryMatch = /boundary=(.+)$/i.exec(String(contentType));

      if (!type.includes('multipart/form-data')) {
        return { fields: {}, files: [] };
      }

      const raw = typeof request.request.body === 'string'
        ? Buffer.from(request.request.body)
        : request.request.body instanceof Uint8Array
          ? Buffer.from(request.request.body)
          : Buffer.alloc(0);

      if (!boundaryMatch?.[1]) {
        return { fields: {}, files: [] };
      }

      return parseMultipart(raw, boundaryMatch[1]);
    },
    config(key, fallback) {
      return getPath(configStore, key, fallback);
    },
    async start() {
      await pluginContainer.setup({ env: (configStore.env as Record<string, string>) ?? {}, logger, bus });

      httpServer = http.createServer(async (nodeRequest, nodeResponse) => {
        const url = new URL(nodeRequest.url ?? '/', `http://${nodeRequest.headers.host ?? 'localhost'}`);
        const requestBody = nodeRequest.method === 'GET' || nodeRequest.method === 'HEAD' ? undefined : await parseJSONBody(nodeRequest);
        const requestContext: RequestContext = {
          request: {
            method: nodeRequest.method ?? 'GET',
            url: url.pathname + url.search,
            headers: Object.fromEntries(Object.entries(nodeRequest.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]))
          },
          response: {
            statusCode: 200,
            headers: {},
            setHeader(name, value) {
              nodeResponse.setHeader(name, value);
            },
            end(body) {
              if (body !== undefined) {
                nodeResponse.end(body);
              } else {
                nodeResponse.end();
              }
            }
          },
          params: {},
          query: url.searchParams,
          state: { body: requestBody, requestId: randomID('req') }
        };

        let matchedRoute: HttpRoute | undefined;
        for (const route of routes) {
          if (route.method !== (nodeRequest.method ?? 'GET').toUpperCase()) {
            continue;
          }

          const match = route.compiled.exec(url.pathname);
          if (match) {
            matchedRoute = route;
            route.keys.forEach((key, index) => {
              requestContext.params[key] = decodeURIComponent(match[index + 1] ?? '');
            });
            break;
          }
        }

        const stack = [...middlewares];
        const composed = async (index: number): Promise<void> => {
          const middleware = stack[index];
          if (!middleware) {
            if (!matchedRoute) {
              sendResponse(nodeResponse, { error: 'Not Found', path: url.pathname }, 404);
              return;
            }

            const output = await matchedRoute.handler(requestContext);
            sendResponse(nodeResponse, output ?? requestContext.state.body ?? { ok: true });
            return;
          }

          const context: MiddlewareContext = {
            request: requestContext,
            async next() {
              await composed(index + 1);
            }
          };

          await middleware(context);
        };

        await composed(0);
      });

      httpServer.on('upgrade', (request, socket, head) => {
        const connection = acceptWebSocket(request, socket as import('node:net').Socket, head);
        if (!connection) {
          return;
        }

        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        const requestContext: RequestContext = {
          request: {
            method: 'GET',
            url: url.pathname + url.search,
            headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(',') : value]))
          },
          response: {
            statusCode: 101,
            headers: {},
            setHeader() {
              return undefined;
            },
            end() {
              return undefined;
            }
          },
          params: {},
          query: url.searchParams,
          state: { socket: connection }
        };

        wsHandler?.(connection, requestContext);
        bus.emit('upgrade' as never, requestContext as never);
      });

      await new Promise<void>(resolve => {
        httpServer?.listen(configStore.port as number, configStore.host as string, () => resolve());
      });

      logger.info(`server running at http://${configStore.host}:${configStore.port}`);
      return {
        url: `http://${configStore.host}:${configStore.port}`,
        async close() {
          await new Promise<void>(resolve => httpServer?.close(() => resolve()));
        }
      };
    },
    async stop() {
      await new Promise<void>(resolve => httpServer?.close(() => resolve()));
      httpServer = undefined;
    },
    onUpgrade(handler) {
      wsHandler = handler;
      return runtime;
    }
  };

  return runtime;
};

export const loadEnvironment = async (cwd = process.cwd()) => {
  const candidates = ['.env', '.env.local', '.env.development'];
  const values: Record<string, string> = {};

  for (const file of candidates) {
    try {
      const raw = await readFile(path.join(cwd, file), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
          continue;
        }

        const index = trimmed.indexOf('=');
        if (index === -1) {
          continue;
        }

        const key = trimmed.slice(0, index).trim();
        const value = trimmed.slice(index + 1).trim().replace(/^"|"$/g, '');
        values[key] = value;
      }
    } catch {
      continue;
    }
  }

  return {
    values,
    get(key: string, fallback = '') {
      return values[key] ?? fallback;
    }
  };
};

export const resolveStaticPath = (baseUrl: string, filePath: string) => {
  const root = path.dirname(fileURLToPath(baseUrl));
  return path.join(root, filePath);
};

export const attachState = (target: Record<string, unknown>, pathName: string, value: unknown) => setPath(target, pathName, value);

export * from '@alexium/types';


