import process from 'node:process';

import { deepMerge, createEventBus } from '../utils/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { createCompiler } from '../compiler/index.js';
import { createBundler } from '../bundler/index.js';
import { createBackendRuntime } from '../backend/index.js';
import { createBrowserBridge } from '../browser/index.js';
import { createHmrRuntime } from '../hmr/index.js';
import { encodeHmrBatch } from '../hmr/packet.js';
import { createPluginManager, type FastiumPlugin } from '../plugins/index.js';
import { createWatcher } from '../watcher/index.js';
import { createTestRuntime } from '../testing/index.js';
import { createSandbox } from '../sandbox/index.js';
import { createPlayground } from '../playground/index.js';
import { Client as DiscordClient } from '../discord/index.js';
import { createCache } from '../cache/index.js';
import { runNativeBenchmarkSuite } from '../native/benchmark/index.js';
import { createRouter } from '../router/index.js';
import { createSignal, createStore } from '../state/index.js';

export interface FastiumConfig {
  framework?: 'fastium' | 'react' | 'vue';
  rootDir?: string;
  entry?: string;
  mode?: 'development' | 'production' | 'test';
  plugins?: FastiumPlugin[];
  server?: { host?: string; port?: number; publicDir?: string; https?: { key: string; cert: string } };
  hmr?: { enabled?: boolean; overlay?: boolean; path?: string } | boolean;
  runtime?: { lowMemoryMode?: boolean; executionTimeoutMs?: number };
  discord?: { intents?: string[] };
}

export interface FastiumRuntime {
  config: Required<Pick<FastiumConfig, 'framework' | 'mode'>> & FastiumConfig;
  logger: Logger;
  compiler: ReturnType<typeof createCompiler>;
  bundler: ReturnType<typeof createBundler>;
  backend: ReturnType<typeof createBackendRuntime>;
  browser: ReturnType<typeof createBrowserBridge>;
  hmr: ReturnType<typeof createHmrRuntime>;
  plugins: ReturnType<typeof createPluginManager>;
  watcher: ReturnType<typeof createWatcher>;
  testing: ReturnType<typeof createTestRuntime>;
  sandbox: ReturnType<typeof createSandbox>;
  playground: ReturnType<typeof createPlayground>;
  discord: DiscordClient;
  state: { createSignal: typeof createSignal; createStore: typeof createStore; createRouter: typeof createRouter };
  cache: ReturnType<typeof createCache>;
  events: ReturnType<typeof createEventBus>;
  bootstrap: () => Promise<FastiumRuntime>;
  dev: () => Promise<{ server: Awaited<ReturnType<ReturnType<typeof createBackendRuntime>['start']>>; browser?: unknown }>;
  build: (entry?: string) => Promise<unknown>;
  start: () => Promise<unknown>;
  test: () => Promise<unknown>;
  doctor: () => Promise<Record<string, unknown>>;
  analyze: (entry?: string) => Promise<Record<string, unknown>>;
  dispose: () => Promise<void>;
}

const createDefaultConfig = (): FastiumConfig => ({
  framework: 'fastium',
  mode: 'development',
  rootDir: process.cwd(),
  entry: 'examples/main.fst',
  server: {
    host: '127.0.0.1',
    port: 3000,
    publicDir: undefined
  },
  hmr: {
    enabled: true,
    overlay: true,
    path: '/fastium-hmr'
  },
  runtime: {
    lowMemoryMode: true,
    executionTimeoutMs: 1000
  },
  discord: {
    intents: []
  }
});

export const createFastium = (config: FastiumConfig = {}): FastiumRuntime => {
  const resolvedConfig = deepMerge(createDefaultConfig(), config);
  const logger = createLogger({ scope: 'fastium', debug: resolvedConfig.mode !== 'production' });
  const events = createEventBus();
  const plugins = createPluginManager(resolvedConfig.plugins ?? []);
  const hmr = createHmrRuntime({ logger: logger.child('hmr') });
  const compiler = createCompiler({ logger: logger.child('compiler') });
  const bundler = createBundler({ rootDir: resolvedConfig.rootDir ?? process.cwd(), logger: logger.child('bundler'), compiler });
  const backend = createBackendRuntime({
    host: resolvedConfig.server?.host,
    port: resolvedConfig.server?.port,
    publicDir: resolvedConfig.server?.publicDir,
    https: resolvedConfig.server?.https,
    logger: logger.child('server'),
    hmr: resolvedConfig.hmr
  });
  const browser = createBrowserBridge({ logger: logger.child('browser') });
  const watcher = createWatcher(resolvedConfig.rootDir ?? process.cwd(), async changes => {
    for (const change of changes) {
      await plugins.hotUpdate({ filePath: change.path, changed: change.event !== 'unlink' });
      try {
        bundler.invalidate(change.path);
      } catch (err) {
        logger.debug('bundler.invalidate failed', err);
      }
      try {
        const rebuild = typeof (bundler as any).rebuildAffected === 'function' ? (bundler as any).rebuildAffected : (bundler as any).rebuildModule;
        const packets = await rebuild(change.path).catch(() => []);
        if (packets.length > 1 && typeof (hmr as any).batch === 'function') {
          (hmr as any).batch(packets);
        } else {
          for (const pkt of packets) {
            hmr.update(pkt.moduleId ?? change.path, pkt.payload);
          }
        }
        if (typeof (bundler as any).analyzeGraph === 'function') {
          hmr.graph((bundler as any).analyzeGraph());
        }
      } catch (err) {
        logger.debug('bundler.rebuildModule failed', err);
        hmr.invalidate(change.path, change);
      }
    }
  });
  const testing = createTestRuntime({ logger: logger.child('test') });
  const sandbox = createSandbox({ timeoutMs: resolvedConfig.runtime?.executionTimeoutMs ?? 1000 });
  const playground = createPlayground();
  const discord = new DiscordClient({ intents: resolvedConfig.discord?.intents ?? [] });
  const cache = createCache<string, unknown>({ maxEntries: 256 });
  const state = { createSignal, createStore, createRouter };

  const runtime: FastiumRuntime = {
    config: resolvedConfig as Required<Pick<FastiumConfig, 'framework' | 'mode'>> & FastiumConfig,
    logger,
    compiler,
    bundler,
    backend,
    browser,
    hmr,
    plugins,
    watcher,
    testing,
    sandbox,
    playground,
    discord,
    state,
    cache,
    events,
    bootstrap: async () => {
      await plugins.setup({ logger, runtime, compiler, server: backend, hmr });
      return runtime;
    },
    dev: async () => {
      await runtime.bootstrap();
      await watcher.start();
      const serverHandle = await backend.start();
      const overlayEnabled = typeof resolvedConfig.hmr === 'object' ? resolvedConfig.hmr.overlay ?? true : true;
      const browserSession = await browser.open(serverHandle.url, overlayEnabled, true);
      return { server: serverHandle, browser: browserSession };
    },
    build: async (entry = resolvedConfig.entry ?? 'examples/main.fst') => {
      await runtime.bootstrap();
      return bundler.bundle(entry);
    },
    start: async () => {
      await runtime.bootstrap();
      return backend.start();
    },
    test: async () => testing.run(),
    doctor: async () => ({
      name: 'fastium',
      framework: resolvedConfig.framework,
      mode: resolvedConfig.mode,
      rootDir: resolvedConfig.rootDir,
      node: process.version,
      lowMemoryMode: resolvedConfig.runtime?.lowMemoryMode ?? false
    }),
    analyze: async (entry = resolvedConfig.entry ?? 'examples/main.fst') => {
      const bundle = await bundler.bundle(entry);
      const native = await runNativeBenchmarkSuite(bundle.code);
      return {
        entry: bundle.entry,
        modules: bundle.modules.length,
        externals: bundle.externals.length,
        hash: bundle.modules.at(0)?.compilation.hash,
        graph: typeof (bundler as any).analyzeGraph === 'function' ? (bundler as any).analyzeGraph() : undefined,
        native: {
          totalMs: native.totalMs,
          results: native.results.map(item => ({ name: item.name, durationMs: item.durationMs, status: item.status }))
        }
      };
    },
    dispose: async () => {
      await plugins.dispose();
      watcher.close();
      await backend.stop();
      hmr.clearState();
      cache.clear();
    }
  };

  // Serve minimal HMR client script
  try {
    const routePath = `${resolvedConfig.hmr && typeof resolvedConfig.hmr === 'object' ? resolvedConfig.hmr.path ?? '/fastium-hmr' : '/fastium-hmr'}/client.js`;
    backend.get(routePath, async (ctx) => {
      try {
        const clientModule = await import('../hmr/client.js');
        const clientScript = typeof clientModule.getHmrClientScript === 'function' ? clientModule.getHmrClientScript() : '';
        ctx.setHeader('content-type', 'application/javascript');
        return ctx.send(clientScript);
      } catch (err) {
        logger.debug('hmr client import failed', err);
        ctx.setHeader('content-type', 'application/javascript');
        return ctx.send('// hmr client unavailable');
      }
    });

    backend.get('/__fastium/browser', async (ctx) => {
      ctx.setHeader('content-type', 'text/html; charset=utf-8');
      return ctx.send(browser.renderInspector({
        server: {
          host: resolvedConfig.server?.host ?? '127.0.0.1',
          port: resolvedConfig.server?.port ?? 3000,
          hmrPath: resolvedConfig.hmr && typeof resolvedConfig.hmr === 'object' ? resolvedConfig.hmr.path ?? '/fastium-hmr' : '/fastium-hmr'
        },
        graph: typeof (bundler as any).analyzeGraph === 'function' ? (bundler as any).analyzeGraph() : undefined,
        hmr: hmr.history(),
        memory: process.memoryUsage()
      }));
    });

    backend.get('/__fastium/graph', async (ctx) => {
      ctx.setHeader('content-type', 'application/json; charset=utf-8');
      return ctx.send(typeof (bundler as any).analyzeGraph === 'function' ? (bundler as any).analyzeGraph() : {});
    });

    backend.get('/__fastium/playground', async (ctx) => {
      ctx.setHeader('content-type', 'text/html; charset=utf-8');
      return ctx.send(playground.renderHtml());
    });

    backend.get('/__fastium/playground/state', async (ctx) => {
      ctx.setHeader('content-type', 'application/json; charset=utf-8');
      return ctx.send(playground.snapshot());
    });

    backend.get('/__fastium/playground/report', async (ctx) => {
      const report = await playground.runValidation({
        rootDir: resolvedConfig.rootDir,
        compiler,
        bundler,
        hmr,
        sandbox
      });
      ctx.setHeader('content-type', 'application/json; charset=utf-8');
      return ctx.send(report);
    });

    backend.get('/__fastium/playground/testing-lab', async (ctx) => {
      const { createTestLab } = await import('../testing-lab/index.js');
      const lab = createTestLab({ rootDir: resolvedConfig.rootDir, logger: logger.child('playground:lab'), keepOnFailure: false });
      const report = await lab.runAll();
      ctx.setHeader('content-type', 'application/json; charset=utf-8');
      return ctx.send(report);
    });
  } catch (err) {
    logger.debug('hmr client route registration failed', err);
  }

  // Wire HMR packets to websocket with microtask batching to minimize allocations
  (() => {
    let queue: unknown[] = [];
    let scheduled = false;

    const flush = () => {
      scheduled = false;
      if (queue.length === 0) return;
      try {
        const packets = queue.slice() as any[];
        queue = [];
        const payload = encodeHmrBatch(packets as any);
        try {
          backend.websocket.broadcast(payload);
          logger.debug('hmr: broadcast', packets.length);
        } catch (err) {
          logger.error('hmr broadcast failed', err);
        }
      } catch (err) {
        logger.error('hmr encode failed', err);
      }
    };

    hmr.events.on('packet', (packet) => {
      queue.push(packet as unknown);
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  })();

  return runtime;
};

export const createAlexium = createFastium;
export const createRuntime = createFastium;
export { createDiagnosticReport, renderErrorOverlay } from '../diagnostics/index.js';
