import type { HMRMessage, HMRServer, HMRUpdate, WatcherHandle } from '@alexium/types';
import { createEventBus, randomID } from '@alexium/utils';
import { createLogger } from '@alexium/logger';
import type { WebSocketConnection } from '@alexium/types';

export interface HMRServerOptions {
  readonly logger?: ReturnType<typeof createLogger>;
}

export const createHMRServer = (options: HMRServerOptions = {}): HMRServer => {
  const logger = options.logger ?? createLogger({ scope: `hmr:${randomID('hmr')}` });
  const sockets = new Set<WebSocketConnection>();
  const bus = createEventBus<{ update: HMRUpdate; connection: string }>();

  return {
    bus,
    connect(socket) {
      sockets.add(socket);
      bus.emit('connection', `connected:${sockets.size}`);
      logger.debug(`hmr client connected (${sockets.size})`);

      try {
        socket.send(JSON.stringify({ type: 'connected', payload: { runtime: 'alexium-hmr' } } satisfies HMRMessage));
      } catch {
        sockets.delete(socket);
      }
    },
    broadcast(update) {
      bus.emit('update', update);
      for (const socket of sockets) {
        try {
          socket.send(JSON.stringify({ type: update.type, path: update.path, payload: update.payload } satisfies HMRMessage));
        } catch {
          sockets.delete(socket);
        }
      }
    },
    attachWatcher(watcher: WatcherHandle) {
      watcher.bus.on('watch', event => {
        if (event.kind === 'add' || event.kind === 'change' || event.kind === 'unlink') {
          this.broadcast({
            type: event.kind === 'unlink' ? 'reload' : 'replace',
            path: event.path ?? 'unknown',
            payload: event.detail
          });
        }
      });
    }
  };
};

export interface HMRClientOptions {
  readonly url: string;
  readonly onUpdate?: (update: HMRUpdate) => void;
  readonly onMessage?: (message: HMRMessage) => void;
}

export const createHMRClient = (options: HMRClientOptions) => {
  const socket = new WebSocket(options.url);
  const handlers = new Map<string, (update: HMRUpdate) => void>();

  socket.addEventListener('message', event => {
    const message = JSON.parse(String((event as MessageEvent).data)) as HMRMessage;
    options.onMessage?.(message);

    if (message.type === 'replace' || message.type === 'reload' || message.type === 'invalidate') {
      const update = message as HMRUpdate;
      handlers.get(update.path)?.(update);
      options.onUpdate?.(update);

      if (!handlers.has(update.path) && update.type === 'reload') {
        globalThis.location?.reload();
      }
    }
  });

  return {
    socket,
    accept(path: string, handler: (update: HMRUpdate) => void) {
      handlers.set(path, handler);
    },
    dispose(path: string) {
      handlers.delete(path);
    }
  };
};
