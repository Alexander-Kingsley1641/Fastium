import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Socket } from 'node:net';

import { createRouter, type Middleware, type RouteContext } from '../router/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { createWebSocketEngine } from '../websocket/index.js';
import { createDiagnosticReport, renderErrorOverlay } from '../diagnostics/index.js';

export interface BackendRuntimeOptions {
  host?: string;
  port?: number;
  https?: { key: string; cert: string };
  publicDir?: string;
  logger?: Logger;
  middleware?: Middleware[];
  hmr?: { enabled?: boolean; path?: string } | boolean;
  overlay?: boolean;
}

export interface BackendServerHandle {
  url: string;
  host: string;
  port: number;
  close: () => Promise<void>;
}

export interface BackendRuntime {
  use: (...middlewares: Middleware[]) => void;
  route: (method: string, pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  get: (pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  post: (pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  put: (pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  patch: (pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  delete: (pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => void;
  start: () => Promise<BackendServerHandle>;
  listen: () => Promise<BackendServerHandle>;
  stop: () => Promise<void>;
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  server: () => Server | undefined;
  websocket: ReturnType<typeof createWebSocketEngine>;
  hmrEnabled: boolean;
  hmrPath: string;
  listRoutes: () => Array<{ method: string; path: string }>;
}

export interface BackendRequestContext extends RouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  status: (statusCode: number) => BackendRequestContext;
  json: (value: unknown, statusCode?: number) => BackendRequestContext;
  text: (value: string, statusCode?: number) => BackendRequestContext;
  send: (value: unknown, statusCode?: number) => BackendRequestContext;
  setHeader: (name: string, value: string) => BackendRequestContext;
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const writeResponse = (response: ServerResponse, value: unknown, statusCode = 200): void => {
  response.statusCode = statusCode;

  if (value === undefined || value === null) {
    response.end();
    return;
  }

  if (typeof value === 'string') {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(value);
    return;
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    response.end(Buffer.from(value));
    return;
  }

  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(value));
};

const injectHmrClient = (content: string, hmrPath: string): string => {
  const script = `<script type="module" src="${hmrPath}/client.js"></script>`;
  if (content.includes('</body>')) {
    return content.replace(/<\/body>/i, `${script}\n</body>`);
  }

  return `${content}\n${script}`;
};

const serveStatic = async (publicDir: string, requestPath: string, response: ServerResponse, enableHmr: boolean, hmrPath: string): Promise<boolean> => {
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const filePath = path.join(publicDir, normalizedPath.replace(/^\//u, ''));
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return false;
    }

    if (enableHmr && filePath.endsWith('.html')) {
      const content = await readFile(filePath, 'utf8');
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(injectHmrClient(content, hmrPath));
      return true;
    }

    const content = await readFile(filePath);
    response.end(content);
    return true;
  } catch {
    return false;
  }
};

export const createBackendRuntime = (options: BackendRuntimeOptions = {}): BackendRuntime => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:server' });
  const router = createRouter();
  const middleware = [...(options.middleware ?? [])];
  const websocket = createWebSocketEngine();
  let server: Server | undefined;

  const hmrEnabled = options.hmr === true || (typeof options.hmr === 'object' ? options.hmr.enabled !== false : false);
  const hmrPath = typeof options.hmr === 'object' ? options.hmr.path ?? '/fastium-hmr' : '/fastium-hmr';

  const registerRoute = (method: string, pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) => {
    const bridge = (context: RouteContext) => handler(context as BackendRequestContext);
    router.route(pathname, bridge, method);
  };

  const handleRequest = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${options.host ?? '127.0.0.1'}:${options.port ?? 0}`}`);
    const bodyText = request.method === 'GET' || request.method === 'HEAD' ? '' : await readBody(request);
    const contentType = String(request.headers['content-type'] ?? '');
    let body: unknown = bodyText;

    if (contentType.includes('application/json') && bodyText) {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = bodyText;
      }
    }

    const match = router.resolve(request.method ?? 'GET', `${url.pathname}${url.search}`);
    const context: BackendRequestContext = {
      method: request.method ?? 'GET',
      path: url.pathname,
      params: match?.params ?? {},
      query: url.searchParams,
      body,
      request,
      response,
      status(statusCode: number) {
        response.statusCode = statusCode;
        return context;
      },
      json(value: unknown, statusCode = 200) {
        response.statusCode = statusCode;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.end(JSON.stringify(value));
        return context;
      },
      text(value: string, statusCode = 200) {
        response.statusCode = statusCode;
        response.setHeader('content-type', 'text/plain; charset=utf-8');
        response.end(value);
        return context;
      },
      send(value: unknown, statusCode = 200) {
        writeResponse(response, value, statusCode);
        return context;
      },
      setHeader(name: string, value: string) {
        response.setHeader(name, value);
        return context;
      }
    };

    try {
      for (const entry of middleware) {
        let nextCalled = false;
        await entry(context, async () => {
          nextCalled = true;
        });

        if (!nextCalled) {
          return;
        }
      }

      if (options.publicDir && await serveStatic(options.publicDir, url.pathname, response, hmrEnabled, hmrPath)) {
        return;
      }

      const result = match ? await match.route.handler(context) : await router.handle(context);
      if (response.writableEnded) {
        return;
      }

      if (result === undefined && !match) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: 'Not Found', path: url.pathname }));
        return;
      }

      writeResponse(response, result, response.statusCode || 200);
    } catch (error) {
      logger.error('request failed', error);
      response.statusCode = 500;
      if (options.overlay !== false && error instanceof Error) {
        const report = createDiagnosticReport(error, bodyText);
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(renderErrorOverlay(report));
        return;
      }

      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error), path: url.pathname }));
    }
  };

  const createServerInstance = (): Server => {
    const instance = options.https ? createHttpsServer({ key: options.https.key, cert: options.https.cert }, handleRequest) : createHttpServer(handleRequest);

    if (hmrEnabled) {
      instance.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
        if (url.pathname !== hmrPath) {
          socket.destroy();
          return;
        }

        const key = request.headers['sec-websocket-key'];
        if (typeof key !== 'string') {
          socket.destroy();
          return;
        }

        websocket.accept(key, socket as Socket, head);
      });
    }

    return instance;
  };

  const start = async (): Promise<BackendServerHandle> => {
    const instance = server ?? (server = createServerInstance());
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? 0;

    await new Promise<void>((resolve, reject) => {
      instance.once('error', reject);
      instance.listen(port, host, () => resolve());
    });

    const address = instance.address();
    const resolvedPort = typeof address === 'object' && address ? address.port : port;
    const protocol = options.https ? 'https' : 'http';
    const url = `${protocol}://${host}:${resolvedPort}`;
    logger.success('server ready', url);

    return {
      url,
      host,
      port: resolvedPort,
      close: async () => {
        await new Promise<void>((resolve, reject) => {
          instance.close(error => (error ? reject(error) : resolve()));
        });
      }
    };
  };

  const stop = async (): Promise<void> => {
    if (!server) {
      websocket.close();
      return;
    }

    const instance = server;
    server = undefined;
    await new Promise<void>((resolve, reject) => {
      instance.close(error => (error ? reject(error) : resolve()));
    });
    websocket.close();
  };

  return {
    use: router.use,
    route: registerRoute,
    get(pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) {
      registerRoute('GET', pathname, handler);
    },
    post(pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) {
      registerRoute('POST', pathname, handler);
    },
    put(pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) {
      registerRoute('PUT', pathname, handler);
    },
    patch(pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) {
      registerRoute('PATCH', pathname, handler);
    },
    delete(pathname: string, handler: (context: BackendRequestContext) => unknown | Promise<unknown>) {
      registerRoute('DELETE', pathname, handler);
    },
    start,
    listen: start,
    stop,
    handle: handleRequest,
    server: () => server,
    websocket,
    hmrEnabled,
    hmrPath,
    listRoutes: router.listRoutes
  };
};

export const createServer = createBackendRuntime;
