import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Buffer } from 'node:buffer';

import { ansi, colorize, formatDuration } from '../utils/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { createFastium } from '../runtime/index.js';
import { createDiscordClient, createEmbed, createButton, createModal } from '../discord/index.js';
import { createWebSocketAcceptKey, createWebSocketChannel, createWebSocketEngine, decodeWebSocketFrame, encodeWebSocketFrame } from '../websocket/index.js';
import { createSignal, createStore } from '../state/index.js';
import { createSandbox } from '../sandbox/index.js';
import { createApp, defineComponent } from '../frontend/index.js';

export type TestLabSuiteName = 'frontend-test' | 'backend-test' | 'discord-test' | 'websocket-test' | 'frontend-build-test';
export type TestLabCommand = TestLabSuiteName | 'all';

export interface TestLabOptions {
  rootDir?: string;
  logger?: Logger;
  keepOnFailure?: boolean;
}

export interface TestLabMetrics {
  startupMs?: number;
  buildMs?: number;
  compileMs?: number;
  hmrMs?: number;
  websocketMs?: number;
  memoryBeforeMb: number;
  memoryAfterMb: number;
  bundleSize?: number;
  routeCount?: number;
  responseMs?: number;
}

export interface TestLabSuiteResult {
  name: TestLabSuiteName;
  projectDir: string;
  status: 'passed' | 'failed';
  durationMs: number;
  metrics: TestLabMetrics;
  diagnostics: string[];
  files: string[];
  error?: { message: string; stack?: string };
}

export interface TestLabReport {
  rootDir: string;
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  suites: TestLabSuiteResult[];
}

const SUITE_ORDER: TestLabSuiteName[] = [
  'frontend-test',
  'backend-test',
  'discord-test',
  'websocket-test',
  'frontend-build-test'
];

const suiteDirectoryName = (suite: TestLabSuiteName): string => suite;

const memorySnapshot = (): number => Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2));

const safeStack = (error: unknown): string => error instanceof Error ? (error.stack ?? error.message) : String(error);

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const ensureCleanDirectory = async (directory: string): Promise<void> => {
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
};

const collectFiles = async (directory: string, results: string[] = []): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, results);
    } else {
      results.push(entryPath);
    }
  }

  return results;
};

const createLabProject = async (rootDir: string, suite: TestLabSuiteName): Promise<{ projectDir: string; entry: string; files: string[] }> => {
  const projectDir = path.join(rootDir, 'testing-lab', suiteDirectoryName(suite));
  await ensureCleanDirectory(projectDir);

  const files: Array<{ filePath: string; content: string }> = [];
  const packageJson = {
    name: `fastium-${suite}`,
    private: true,
    type: 'module',
    scripts: {
      build: 'fast build',
      test: 'fast test'
    }
  };

  switch (suite) {
    case 'frontend-test':
    case 'frontend-build-test':
      files.push(
        { filePath: path.join(projectDir, 'package.json'), content: `${JSON.stringify(packageJson, null, 2)}\n` },
        {
          filePath: path.join(projectDir, 'fast.config.js'),
          content: `export default {
  framework: 'fastium',
  mode: 'development',
  entry: 'src/main.fst',
  runtime: { lowMemoryMode: true, executionTimeoutMs: 1000 },
  hmr: { enabled: true, overlay: true }
};
`
        },
        {
          filePath: path.join(projectDir, 'src', 'main.fst'),
          content: `import { createApp, defineComponent } from 'fastium';
import { createLazyState } from './lazy';

const Shell = defineComponent('Shell', () => '<main><h1>Fastium Lab</h1><p>Frontend validation project</p></main>');
const app = createApp();
const counter = app.signal('counter', 0);
const lazyState = createLazyState();

app.route('/', () => Shell);
app.route('/state', () => ({ counter: counter.get(), lazy: lazyState.ready }));

export default app;
`
        },
        {
          filePath: path.join(projectDir, 'src', 'lazy.ts'),
          content: `export const createLazyState = () => ({
  ready: true,
  label: 'lazy-loaded'
});
`
        }
      );
      break;
    case 'backend-test':
      files.push(
        { filePath: path.join(projectDir, 'package.json'), content: `${JSON.stringify(packageJson, null, 2)}\n` },
        {
          filePath: path.join(projectDir, 'fast.config.js'),
          content: `export default {
  framework: 'fastium',
  mode: 'test',
  entry: 'src/server.ts',
  runtime: { lowMemoryMode: true, executionTimeoutMs: 1000 },
  server: { host: '127.0.0.1', port: 0 },
  hmr: { enabled: true, overlay: true }
};
`
        },
        {
          filePath: path.join(projectDir, 'src', 'server.ts'),
          content: `import { createCache, createLogger, createServer } from 'fastium';

const logger = createLogger({ scope: 'lab:backend' });
const cache = createCache<string, unknown>({ maxEntries: 16 });
const server = createServer({ host: '127.0.0.1', port: 0, logger, hmr: { enabled: true } });

server.use(async (context, next) => {
  context.setHeader('x-fastium-lab', 'backend');
  await next();
});

server.get('/health', context => context.json({ ok: true, path: context.path }));
server.post('/echo', context => {
  cache.set('last-body', context.body ?? null);
  return context.json({ ok: true, body: context.body });
});
server.get('/stream', context => context.send('stream-ok'));

export default server;
`
        }
      );
      break;
    case 'discord-test':
      files.push(
        { filePath: path.join(projectDir, 'package.json'), content: `${JSON.stringify(packageJson, null, 2)}\n` },
        {
          filePath: path.join(projectDir, 'fast.config.js'),
          content: `export default {
  framework: 'fastium',
  mode: 'test',
  entry: 'src/bot.ts',
  discord: { intents: ['Guilds', 'GuildMessages'] }
};
`
        },
        {
          filePath: path.join(projectDir, 'src', 'bot.ts'),
          content: `import { Client, createButton, createEmbed, createModal } from 'fastium';

const client = new Client({ intents: ['Guilds', 'GuildMessages'] });

client.registerSlashCommand({
  name: 'ping',
  description: 'Ping Fastium',
  execute: () => ({ pong: true })
});

client.registerMessageCommand('inspect', payload => ({ payload, embed: createEmbed('Lab', 'Discord validation') }));

const ui = {
  button: createButton('Inspect'),
  modal: createModal('Report')
};

export default { client, ui };
`
        }
      );
      break;
    case 'websocket-test':
      files.push(
        { filePath: path.join(projectDir, 'package.json'), content: `${JSON.stringify(packageJson, null, 2)}\n` },
        {
          filePath: path.join(projectDir, 'fast.config.js'),
          content: `export default {
  framework: 'fastium',
  mode: 'test',
  entry: 'src/socket.ts',
  runtime: { lowMemoryMode: true }
};
`
        },
        {
          filePath: path.join(projectDir, 'src', 'socket.ts'),
          content: `import { createWebSocketAcceptKey, createWebSocketChannel, createWebSocketEngine, decodeWebSocketFrame, encodeWebSocketFrame } from 'fastium';

export const engine = createWebSocketEngine();
export const acceptKey = createWebSocketAcceptKey('fastium');
export const encoded = encodeWebSocketFrame('fastium');
export const decoded = decodeWebSocketFrame(encoded);
export const channel = createWebSocketChannel(frame => frame);
`
        }
      );
      break;
  }

  await mkdir(path.join(projectDir, 'src'), { recursive: true });
  for (const file of files) {
    await mkdir(path.dirname(file.filePath), { recursive: true });
    await writeFile(file.filePath, file.content, 'utf8');
  }

  const collected = await collectFiles(projectDir);
  return {
    projectDir,
    entry: path.join(projectDir, suite === 'backend-test' ? 'src/server.ts' : suite === 'discord-test' ? 'src/bot.ts' : suite === 'websocket-test' ? 'src/socket.ts' : 'src/main.fst'),
    files: collected
  };
};

const validateFrontend = async (projectDir: string, entry: string): Promise<{ metrics: TestLabMetrics; diagnostics: string[] }> => {
  const runtime = createFastium({ rootDir: projectDir, entry: 'src/main.fst', mode: 'production' });
  const diagnostics: string[] = [];
  const memoryBefore = memorySnapshot();

  const compileStarted = performance.now();
  const compiled = await runtime.compiler.compileFile(entry);
  const compileMs = performance.now() - compileStarted;
  diagnostics.push(`compiled ${path.basename(entry)} -> ${compiled.hash}`);

  const renderApp = createApp();
  const card = defineComponent('LabCard', () => '<section data-lab="frontend">Fastium frontend</section>');
  renderApp.route('/', () => card);
  renderApp.signal('count', 1).set(2);
  const rendered = await renderApp.render(card);
  if (!rendered.includes('Fastium frontend')) {
    throw new Error('frontend rendering did not produce the expected markup');
  }

  const routeMatch = renderApp.resolve('GET', '/');
  if (!routeMatch) {
    throw new Error('frontend route did not resolve');
  }

  const store = createStore({ count: 1, nested: { ready: true } });
  store.patch({ count: 2 });
  const signal = createSignal('ready');
  signal.set('steady');

  const sandbox = createSandbox({ timeoutMs: 250 });
  const sandboxResult = await sandbox.runModule('module.exports = { value: 2 + 2, ready: true };', { filename: 'frontend-lab.js' });
  if ((sandboxResult as { value?: number }).value !== 4) {
    throw new Error('sandbox validation failed');
  }

  const packets: unknown[] = [];
  const off = runtime.hmr.events.on('packet', packet => {
    packets.push(packet);
  });
  runtime.hmr.remember('lab-frontend', { ready: true });
  runtime.hmr.invalidate('lab-frontend', { reason: 'lab-check' });
  runtime.hmr.update('lab-frontend', { ready: false });
  runtime.hmr.reload({ reason: 'lab-reload' });
  off();

  const buildStarted = performance.now();
  const bundle = await runtime.build('src/main.fst') as { modules: Array<{ filePath?: string }>; externals: string[] };
  const buildMs = performance.now() - buildStarted;
  const memoryAfter = memorySnapshot();

  diagnostics.push(`hmr packets ${packets.length}`);
  diagnostics.push(`bundle modules ${bundle.modules.length}`);

  await runtime.dispose();

  return {
    metrics: {
      compileMs,
      buildMs,
      hmrMs: packets.length,
      memoryBeforeMb: memoryBefore,
      memoryAfterMb: memoryAfter,
      bundleSize: bundle.modules.length,
      routeCount: 2
    },
    diagnostics
  };
};

const validateBackend = async (projectDir: string): Promise<{ metrics: TestLabMetrics; diagnostics: string[] }> => {
  const runtime = createFastium({ rootDir: projectDir, entry: 'src/server.ts', mode: 'test', server: { host: '127.0.0.1', port: 0 }, hmr: { enabled: true } });
  const diagnostics: string[] = [];
  const memoryBefore = memorySnapshot();
  let serverHandle: Awaited<ReturnType<typeof runtime.backend.start>> | undefined;

  runtime.backend.use(async (context, next) => {
    ((context as unknown) as { setHeader: (name: string, value: string) => void }).setHeader('x-fastium-lab', 'backend');
    await next();
  });

  runtime.backend.get('/health', context => context.json({ ok: true, path: context.path }));
  runtime.backend.post('/echo', context => context.json({ ok: true, body: context.body }));
  runtime.backend.get('/stream', context => context.send('stream-ok'));

  try {
    const startedAt = performance.now();
    serverHandle = await runtime.backend.start();
    const startupMs = performance.now() - startedAt;
    diagnostics.push(`server ${serverHandle.url}`);

    const createRequest = (method: string, url: string, body?: string) => ({
      method,
      url,
      headers: { host: '127.0.0.1', 'content-type': 'application/json' },
      async *[Symbol.asyncIterator]() {
        if (body) {
          yield Buffer.from(body);
        }
      }
    });

    const createResponse = () => {
      let body = '';
      const headers: Record<string, string> = {};
      return {
        statusCode: 200,
        writableEnded: false,
        setHeader(name: string, value: string) {
          headers[name.toLowerCase()] = value;
        },
        end(chunk?: string | Buffer) {
          if (chunk !== undefined) {
            body = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          }
          this.writableEnded = true;
        },
        getBody() {
          return body;
        },
        getHeaders() {
          return headers;
        }
      };
    };

    const healthResponse = createResponse();
    await runtime.backend.handle(createRequest('GET', '/health') as never, healthResponse as never);
    const healthBody = JSON.parse(healthResponse.getBody() || '{}') as { ok?: boolean };
    if (healthResponse.statusCode !== 200 || !healthBody.ok) {
      throw new Error('backend health request failed');
    }

    const echoResponse = createResponse();
    await runtime.backend.handle(createRequest('POST', '/echo', JSON.stringify({ ping: true })) as never, echoResponse as never);
    const echoBody = JSON.parse(echoResponse.getBody() || '{}') as { body?: { ping?: boolean } };
    if (echoResponse.statusCode !== 200 || !echoBody.body?.ping) {
      throw new Error('backend echo request failed');
    }

    const streamResponse = createResponse();
    await runtime.backend.handle(createRequest('GET', '/stream') as never, streamResponse as never);
    if (streamResponse.statusCode !== 200 || streamResponse.getBody().indexOf('stream-ok') === -1) {
      throw new Error('backend stream request failed');
    }

    const writes: Buffer[] = [];
    const fakeSocket = {
      write(chunk: Buffer | string) {
        writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return true;
      },
      once() {
        return this;
      },
      end() {
        return this;
      },
      destroy() {
        return this;
      },
      unshift() {
        return true;
      }
    } as never;

    runtime.backend.websocket.accept(createWebSocketAcceptKey('fastium-lab'), fakeSocket, Buffer.alloc(0));
    if (writes.length === 0) {
      throw new Error('websocket upgrade did not produce a handshake');
    }

    const memoryAfter = memorySnapshot();
    diagnostics.push('websocket upgrade accepted');

    return {
      metrics: {
        startupMs,
        responseMs: 0,
        memoryBeforeMb: memoryBefore,
        memoryAfterMb: memoryAfter,
        routeCount: 3
      },
      diagnostics
    };
  } finally {
    await runtime.dispose();
  }
};

const validateDiscord = async (projectDir: string): Promise<{ metrics: TestLabMetrics; diagnostics: string[] }> => {
  void projectDir;
  const diagnostics: string[] = [];
  const memoryBefore = memorySnapshot();
  const client = createDiscordClient({ intents: ['Guilds', 'GuildMessages'] });

  client.registerSlashCommand({
    name: 'ping',
    description: 'Ping Fastium',
    execute: () => ({ pong: true })
  });

  client.registerMessageCommand('inspect', payload => ({ payload, embed: createEmbed('Lab', 'Discord validation') }));

  const loginStarted = performance.now();
  await client.login('lab-token');
  const startupMs = performance.now() - loginStarted;

  const slash = await client.dispatchInteraction({ type: 'slash', name: 'ping' });
  if (!(slash as { pong?: boolean })?.pong) {
    throw new Error('discord slash command failed');
  }

  const message = await client.dispatchInteraction({ type: 'message', commandName: 'inspect', payload: { ok: true } });
  if (!(message as { embed?: { title?: string } })?.embed?.title) {
    throw new Error('discord message command failed');
  }

  const modal = createModal('Report');
  const button = createButton('Inspect');
  diagnostics.push(`modal ${modal.customId}`);
  diagnostics.push(`button ${button.customId}`);

  client.reloadHandlers();
  await client.destroy();
  const memoryAfter = memorySnapshot();

  return {
    metrics: {
      startupMs,
      memoryBeforeMb: memoryBefore,
      memoryAfterMb: memoryAfter,
      routeCount: client.commands.size + client.messageCommands.size
    },
    diagnostics
  };
};

const validateWebsocket = async (projectDir: string): Promise<{ metrics: TestLabMetrics; diagnostics: string[] }> => {
  void projectDir;
  const diagnostics: string[] = [];
  const memoryBefore = memorySnapshot();
  const engine = createWebSocketEngine();

  const acceptedKey = createWebSocketAcceptKey('fastium-lab');
  const encoded = encodeWebSocketFrame('fastium');
  const decoded = decodeWebSocketFrame(encoded);
  if (!decoded || decoded.payload.length === 0) {
    throw new Error('websocket frame decoding failed');
  }

  const writes: Buffer[] = [];
  const fakeSocket = {
    write(chunk: Buffer | string) {
      writes.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return true;
    },
    once() {
      return this;
    },
    end() {
      return this;
    },
    destroy() {
      return this;
    },
    unshift() {
      return true;
    }
  } as never;

  engine.accept(acceptedKey, fakeSocket, Buffer.alloc(0));
  engine.broadcast('hello');

  const channelFrames: Buffer[] = [];
  const channel = createWebSocketChannel(frame => channelFrames.push(frame));
  channel.sendText('fastium');
  channel.sendBinary(Buffer.from([1, 2, 3]));
  channel.ping();
  channel.close();

  await Promise.resolve();
  const memoryAfter = memorySnapshot();
  diagnostics.push(`handshake key ${acceptedKey.slice(0, 12)}…`);
  diagnostics.push(`frames ${writes.length + channelFrames.length}`);

  return {
    metrics: {
      websocketMs: Number((writes.length + channelFrames.length).toFixed(2)),
      memoryBeforeMb: memoryBefore,
      memoryAfterMb: memoryAfter,
      routeCount: writes.length + channelFrames.length
    },
    diagnostics
  };
};

const validateBuild = async (projectDir: string, entry: string): Promise<{ metrics: TestLabMetrics; diagnostics: string[] }> => {
  const runtime = createFastium({ rootDir: projectDir, entry: path.relative(projectDir, entry), mode: 'production' });
  const diagnostics: string[] = [];
  const memoryBefore = memorySnapshot();

  const buildStarted = performance.now();
  const bundle = await runtime.build(path.relative(projectDir, entry)) as { modules: Array<unknown>; externals: string[] };
  const buildMs = performance.now() - buildStarted;

  const compiled = await runtime.compiler.compileFile(entry);
  diagnostics.push(`compiled ${compiled.hash}`);
  diagnostics.push(`bundle externals ${bundle.externals.length}`);

  const memoryAfter = memorySnapshot();
  await runtime.dispose();

  return {
    metrics: {
      buildMs,
      memoryBeforeMb: memoryBefore,
      memoryAfterMb: memoryAfter,
      bundleSize: bundle.modules.length
    },
    diagnostics
  };
};

const formatResult = (result: TestLabSuiteResult): string => {
  const statusLabel = result.status === 'passed' ? colorize('PASS', ansi.green) : colorize('FAIL', ansi.red);
  return `${statusLabel} ${result.name} ${formatDuration(result.durationMs)} ${result.projectDir}`;
};

const formatReport = (report: TestLabReport): string => {
  const lines: string[] = [];
  lines.push(colorize('Fastium Test Lab', ansi.bold));
  lines.push(`${report.passed}/${report.total} suites passed in ${formatDuration(report.durationMs)}`);
  for (const suite of report.suites) {
    lines.push(formatResult(suite));
    for (const diagnostic of suite.diagnostics) {
      lines.push(`  ${diagnostic}`);
    }
    const metrics = suite.metrics;
    const metricParts = [
      metrics.startupMs !== undefined ? `Startup ${formatDuration(metrics.startupMs)}` : undefined,
      metrics.buildMs !== undefined ? `Build ${formatDuration(metrics.buildMs)}` : undefined,
      metrics.compileMs !== undefined ? `Compile ${formatDuration(metrics.compileMs)}` : undefined,
      metrics.hmrMs !== undefined ? `HMR ${metrics.hmrMs} events` : undefined,
      metrics.websocketMs !== undefined ? `WebSocket ${formatDuration(metrics.websocketMs)}` : undefined,
      `RAM ${metrics.memoryAfterMb.toFixed(2)}MB`
    ].filter(Boolean);
    lines.push(`  ${metricParts.join(' | ')}`);
  }

  return lines.join('\n');
};

export const createTestLab = (options: TestLabOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const logger = options.logger ?? createLogger({ scope: 'fastium:test-lab' });
  const keepOnFailure = options.keepOnFailure ?? true;
  const labRoot = path.join(rootDir, 'testing-lab');

  const runSuite = async (suite: TestLabSuiteName): Promise<TestLabSuiteResult> => {
    const suiteStarted = performance.now();
    const project = await createLabProject(rootDir, suite);
    const diagnostics: string[] = [];
    let metrics: TestLabMetrics = { memoryBeforeMb: memorySnapshot(), memoryAfterMb: memorySnapshot() };

    try {
      if (suite === 'frontend-test') {
        const validation = await validateFrontend(project.projectDir, project.entry);
        metrics = validation.metrics;
        diagnostics.push(...validation.diagnostics);
      } else if (suite === 'backend-test') {
        const validation = await validateBackend(project.projectDir);
        metrics = validation.metrics;
        diagnostics.push(...validation.diagnostics);
      } else if (suite === 'discord-test') {
        const validation = await validateDiscord(project.projectDir);
        metrics = validation.metrics;
        diagnostics.push(...validation.diagnostics);
      } else if (suite === 'websocket-test') {
        const validation = await validateWebsocket(project.projectDir);
        metrics = validation.metrics;
        diagnostics.push(...validation.diagnostics);
      } else {
        const validation = await validateBuild(project.projectDir, project.entry);
        metrics = validation.metrics;
        diagnostics.push(...validation.diagnostics);
      }

      const result: TestLabSuiteResult = {
        name: suite,
        projectDir: project.projectDir,
        status: 'passed',
        durationMs: performance.now() - suiteStarted,
        metrics,
        diagnostics,
        files: project.files
      };

      await writeJson(path.join(project.projectDir, 'lab-report.json'), result);
      logger.success(formatResult(result));
      return result;
    } catch (error) {
      const result: TestLabSuiteResult = {
        name: suite,
        projectDir: project.projectDir,
        status: 'failed',
        durationMs: performance.now() - suiteStarted,
        metrics,
        diagnostics,
        files: project.files,
        error: { message: error instanceof Error ? error.message : String(error), stack: safeStack(error) }
      };

      await writeJson(path.join(project.projectDir, 'lab-report.json'), result);
      logger.error(formatResult(result), error);
      if (!keepOnFailure) {
        await rm(project.projectDir, { recursive: true, force: true });
      }

      return result;
    }
  };

  const runAll = async (): Promise<TestLabReport> => {
    const startedAt = performance.now();
    await mkdir(labRoot, { recursive: true });
    const suites: TestLabSuiteResult[] = [];

    for (const suite of SUITE_ORDER) {
      suites.push(await runSuite(suite));
    }

    const report: TestLabReport = {
      rootDir: labRoot,
      generatedAt: new Date().toISOString(),
      total: suites.length,
      passed: suites.filter(item => item.status === 'passed').length,
      failed: suites.filter(item => item.status === 'failed').length,
      durationMs: performance.now() - startedAt,
      suites
    };

    await writeJson(path.join(labRoot, 'lab-report.json'), report);
    logger.info(formatReport(report));

    if (keepOnFailure && report.failed === 0) {
      await cleanup(report);
    }

    return report;
  };

  const cleanup = async (report?: TestLabReport): Promise<void> => {
    const projectDirs = report?.suites.map(item => item.projectDir) ?? (await stat(labRoot).then(() => SUITE_ORDER.map(suite => path.join(labRoot, suite))).catch(() => []));
    for (const projectDir of projectDirs) {
      await rm(projectDir, { recursive: true, force: true });
    }
  };

  const runCommand = async (command: TestLabCommand): Promise<TestLabReport | TestLabSuiteResult> => {
    if (command === 'all') {
      return runAll();
    }

    return runSuite(command);
  };

  return {
    rootDir: labRoot,
    suites: SUITE_ORDER,
    runSuite,
    runAll,
    runCommand,
    cleanup,
    formatReport,
    formatResult
  };
};