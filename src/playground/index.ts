import { performance } from 'node:perf_hooks';
import path from 'node:path';

import { createCompiler, type CompilationResult } from '../compiler/index.js';
import { createApp, defineComponent } from '../frontend/index.js';
import { createGraph } from '../graph/index.js';
import type { HmrPacket } from '../hmr/index.js';
import { analyzeCompilationNative, runNativeBenchmarkSuite } from '../native/index.js';
import { createSandbox } from '../sandbox/index.js';
import { createSignal } from '../state/index.js';
import { createWebSocketAcceptKey, decodeWebSocketFrame, encodeWebSocketFrame, WebSocketFrameDecoder } from '../websocket/index.js';
import { randomId } from '../utils/random-id.js';

export interface PlaygroundFile {
  path: string;
  content: string;
  language: string;
}

export interface PlaygroundBenchmark {
  name: string;
  durationMs: number;
  targetMs: number;
  status: 'pass' | 'warn' | 'fail';
}

export interface PlaygroundDiagnostic {
  source: 'compiler' | 'runtime' | 'hmr' | 'websocket' | 'sandbox' | 'package' | 'recommendation' | 'native';
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface PlaygroundGraphNode {
  id: string;
  imports: string[];
  importedBy: string[];
}

export interface PlaygroundRuntimeSnapshot {
  status: 'idle' | 'running' | 'passed' | 'failed';
  packageName: 'fastium';
  compilerHash?: string;
  compiledBytes: number;
  graphModules: number;
  hmrPackets: number;
  websocketLatencyMs: number;
  nativeTimingMs: number;
  memoryMb: number;
  lastRunAt?: string;
}

export interface PlaygroundRecommendation {
  title: string;
  detail: string;
  priority: 'low' | 'medium' | 'high';
}

export interface PlaygroundState {
  name: string;
  framework: 'fastium' | 'react' | 'vue';
  activeFile: string;
  activeBottomTab: 'console' | 'hmr' | 'websocket' | 'memory' | 'diagnostics' | 'benchmarks';
  files: PlaygroundFile[];
  packages: string[];
  routes: string[];
  graph: PlaygroundGraphNode[];
  console: string[];
  diagnostics: PlaygroundDiagnostic[];
  hmrLog: HmrPacket[];
  websocketLog: string[];
  benchmarks: PlaygroundBenchmark[];
  recommendations: PlaygroundRecommendation[];
  testRoots: string[];
  runtime: PlaygroundRuntimeSnapshot;
  previewHtml: string;
}

export interface PlaygroundValidationContext {
  rootDir?: string;
  compiler?: ReturnType<typeof createCompiler>;
  hmr?: {
    remember: (moduleId: string, value: unknown) => unknown;
    update: (moduleId: string, payload: unknown) => HmrPacket;
    invalidate: (moduleId: string, payload?: unknown) => HmrPacket;
    history?: () => HmrPacket[];
  };
  bundler?: {
    bundle?: (entry: string) => Promise<{ modules?: Array<{ id?: string; filePath?: string; dependencies?: string[]; compilation?: CompilationResult }>; code?: string }>;
    analyzeGraph?: () => Record<string, unknown>;
  };
  sandbox?: ReturnType<typeof createSandbox>;
}

export interface PlaygroundValidationReport {
  runtime: PlaygroundRuntimeSnapshot;
  diagnostics: PlaygroundDiagnostic[];
  benchmarks: PlaygroundBenchmark[];
  recommendations: PlaygroundRecommendation[];
}

const TARGET_MS = 10;

const defaultFiles: PlaygroundFile[] = [
  {
    path: 'src/main.fst',
    language: 'fst',
    content: "import { createApp, defineComponent } from 'fastium';\n\nconst Shell = defineComponent('Shell', () => '<main class=\"fastium-preview\"><h1>Fastium Runtime Lab</h1><p>Compiler, HMR, websocket, sandbox, and package validation are live.</p></main>');\nconst app = createApp();\nconst counter = app.signal('counter', 1);\napp.route('/', () => Shell);\napp.route('/state', () => ({ counter: counter.get() }));\nexport default app;\n"
  },
  {
    path: 'src/server.ts',
    language: 'ts',
    content: "import { createServer } from 'fastium';\n\nconst server = createServer({ hmr: { enabled: true } });\nserver.get('/health', context => context.json({ ok: true, runtime: 'fastium' }));\nexport default server;\n"
  },
  {
    path: 'src/bot.ts',
    language: 'ts',
    content: "import { Client, createEmbed } from 'fastium/discord';\n\nconst client = new Client({ intents: ['Guilds'] });\nclient.registerSlashCommand({ name: 'ping', description: 'Ping Fastium', execute: () => createEmbed('Fastium', 'pong') });\nexport default client;\n"
  },
  {
    path: 'styles.css',
    language: 'css',
    content: ':root { color-scheme: dark; --fastium-accent: #38bdf8; }'
  }
];

const defaultRuntime = (): PlaygroundRuntimeSnapshot => ({
  status: 'idle',
  packageName: 'fastium',
  compiledBytes: 0,
  graphModules: 0,
  hmrPackets: 0,
  websocketLatencyMs: 0,
  nativeTimingMs: 0,
  memoryMb: memoryMb()
});

const memoryMb = (): number => Number((process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2));

const benchmarkStatus = (durationMs: number): PlaygroundBenchmark['status'] => durationMs <= TARGET_MS ? 'pass' : durationMs <= TARGET_MS * 3 ? 'warn' : 'fail';

const benchmark = async (name: string, run: () => unknown | Promise<unknown>): Promise<PlaygroundBenchmark> => {
  const startedAt = performance.now();
  await run();
  const durationMs = performance.now() - startedAt;
  return {
    name,
    durationMs: Number(durationMs.toFixed(3)),
    targetMs: TARGET_MS,
    status: benchmarkStatus(durationMs)
  };
};

const diagnostic = (source: PlaygroundDiagnostic['source'], level: PlaygroundDiagnostic['level'], message: string): PlaygroundDiagnostic => ({
  source,
  level,
  message,
  timestamp: Date.now()
});

const detectRecommendations = (state: PlaygroundState): PlaygroundRecommendation[] => {
  const recommendations: PlaygroundRecommendation[] = [];
  const fstFiles = state.files.filter(file => file.path.endsWith('.fst'));
  const runtimeFiles = state.files.filter(file => file.path.includes('runtime') || file.path.includes('server'));
  const hmrAware = state.files.some(file => file.content.includes('import.meta.hot') || file.content.includes('__FASTIUM_HMR__'));

  if (fstFiles.length > 1) {
    recommendations.push({
      title: 'Isolate HMR boundaries',
      detail: 'Multiple .fst modules are active. Keep route-level modules as HMR boundaries so Fastium can patch only the affected graph path.',
      priority: 'high'
    });
  }

  if (runtimeFiles.length > 0) {
    recommendations.push({
      title: 'Split runtime modules',
      detail: 'Backend and runtime files are present. Keep request handlers, websocket channels, and state stores in separate modules to reduce invalidation fan-out.',
      priority: 'medium'
    });
  }

  if (!hmrAware) {
    recommendations.push({
      title: 'Add explicit hot accept handlers',
      detail: 'No explicit HMR accept boundary was detected. Add module-level accept/dispose hooks for stateful previews and long-lived websocket sessions.',
      priority: 'medium'
    });
  }

  if (state.files.some(file => file.content.includes('new Array') || file.content.includes('JSON.stringify'))) {
    recommendations.push({
      title: 'Reduce transient allocations',
      detail: 'Allocation-heavy patterns were detected. Prefer reusable buffers, object pools, and cached serialization for hot runtime paths.',
      priority: 'low'
    });
  }

  return recommendations;
};

const createPreviewHtml = (compiledCode = ''): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: dark; --bg: #050b14; --text: #e5f3ff; --muted: #89a7c4; --accent: #38bdf8; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: radial-gradient(circle at 20% 10%, rgba(56, 189, 248, .2), transparent 32%), linear-gradient(145deg, #07111f, #02050a); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; }
      .fastium-preview { max-width: 620px; padding: 32px; border: 1px solid rgba(56, 189, 248, .28); background: rgba(8, 15, 28, .82); box-shadow: 0 0 36px rgba(56, 189, 248, .16); }
      h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.1; }
      p { margin: 0; color: var(--muted); line-height: 1.6; }
      code { color: var(--accent); }
    </style>
  </head>
  <body>
    <main class="fastium-preview">
      <h1>Fastium Runtime Lab</h1>
      <p>Compiled <code>${compiledCode.length}</code> bytes through the real Fastium compiler and sandbox validation pipeline.</p>
    </main>
  </body>
</html>`;

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const renderStatusDot = (status: string): string => `<span class="dot dot-${escapeHtml(status)}"></span>`;

const renderBenchmarks = (benchmarks: PlaygroundBenchmark[]): string => benchmarks
  .map(item => `<div class="metric-row"><span>${escapeHtml(item.name)}</span><strong class="${item.status}">${item.durationMs.toFixed(3)}ms</strong></div>`)
  .join('');

const renderDiagnostics = (diagnostics: PlaygroundDiagnostic[]): string => diagnostics
  .map(item => `<li class="${item.level}"><span>${escapeHtml(item.source)}</span>${escapeHtml(item.message)}</li>`)
  .join('');

const renderGraph = (graph: PlaygroundGraphNode[]): string => graph
  .map(node => `<li><strong>${escapeHtml(node.id)}</strong><span>${node.imports.length} imports / ${node.importedBy.length} parents</span></li>`)
  .join('');

const renderRecommendations = (recommendations: PlaygroundRecommendation[]): string => recommendations
  .map(item => `<li class="${item.priority}"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.detail)}</span></li>`)
  .join('');

const createShellHtml = (state: PlaygroundState): string => {
  const activeFile = state.files.find(file => file.path === state.activeFile) ?? state.files[0];
  const hmrStatus = state.runtime.hmrPackets > 0 ? 'passed' : 'idle';
  const buildStatus = state.runtime.status;
  const srcdoc = escapeHtml(state.previewHtml);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fastium Playground</title>
    <style>
      :root { color-scheme: dark; --bg: #030712; --chrome: #070d18; --panel: #0a1220; --panel-2: #0d1728; --line: rgba(125, 211, 252, .18); --line-strong: rgba(56, 189, 248, .38); --text: #e5f2ff; --muted: #83a4c5; --dim: #58708e; --cyan: #38bdf8; --cyan-2: #22d3ee; --green: #22c55e; --yellow: #facc15; --red: #fb7185; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      body { min-height: 100vh; overflow: hidden; }
      .shell { display: grid; grid-template-rows: 48px minmax(0, 1fr) 210px 30px; height: 100vh; background: radial-gradient(circle at 18% 0%, rgba(34, 211, 238, .16), transparent 28%), radial-gradient(circle at 80% 6%, rgba(56, 189, 248, .11), transparent 30%), var(--bg); }
      .navbar, .statusbar { display: flex; align-items: center; gap: 14px; padding: 0 14px; background: rgba(5, 10, 18, .94); border-bottom: 1px solid var(--line); backdrop-filter: blur(18px); min-width: 0; }
      .statusbar { border-top: 1px solid var(--line); border-bottom: 0; color: var(--muted); font-size: 12px; justify-content: space-between; }
      .brand { display: inline-flex; align-items: center; gap: 9px; font-weight: 800; letter-spacing: .02em; min-width: 172px; }
      .logo { width: 20px; height: 20px; border: 1px solid var(--cyan); box-shadow: 0 0 18px rgba(56, 189, 248, .55), inset 0 0 12px rgba(56, 189, 248, .28); transform: rotate(45deg); }
      .status-pill { display: inline-flex; align-items: center; gap: 7px; height: 26px; padding: 0 10px; border: 1px solid rgba(125, 211, 252, .16); background: rgba(13, 23, 40, .78); color: var(--muted); font-size: 12px; white-space: nowrap; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dim); box-shadow: 0 0 12px currentColor; }
      .dot-passed, .dot-pass { background: var(--green); color: var(--green); }
      .dot-running, .dot-warn { background: var(--yellow); color: var(--yellow); }
      .dot-failed, .dot-fail { background: var(--red); color: var(--red); }
      .workspace { display: grid; grid-template-columns: 270px minmax(420px, 1fr) 390px; min-height: 0; border-bottom: 1px solid var(--line); }
      .panel { min-height: 0; background: rgba(8, 15, 28, .92); border-right: 1px solid var(--line); overflow: hidden; }
      .panel:last-child { border-right: 0; }
      .section-title { height: 34px; display: flex; align-items: center; justify-content: space-between; padding: 0 12px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
      .sidebar { display: grid; grid-template-rows: 28% 24% 24% 24%; }
      ul { list-style: none; margin: 0; padding: 0; }
      .list { overflow: auto; min-height: 0; }
      .list li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 12px; border-bottom: 1px solid rgba(125, 211, 252, .08); color: #c9ddf3; font-size: 12px; }
      .list li strong { font-size: 12px; color: #e7f5ff; font-weight: 650; }
      .list li span { color: var(--muted); }
      .file-active { background: rgba(56, 189, 248, .12); border-left: 2px solid var(--cyan); }
      .editor { display: grid; grid-template-rows: 36px minmax(0, 1fr); background: #07101d; }
      .tabs { display: flex; align-items: end; gap: 1px; padding-left: 8px; border-bottom: 1px solid var(--line); background: #070d18; overflow: hidden; }
      .tab { height: 30px; display: inline-flex; align-items: center; padding: 0 12px; background: #0a1424; border: 1px solid rgba(125, 211, 252, .12); border-bottom: 0; color: var(--muted); font-size: 12px; }
      .tab.active { color: var(--text); border-color: var(--line-strong); box-shadow: inset 0 2px 0 var(--cyan); }
      .editor-area { min-height: 0; display: grid; grid-template-columns: 52px 1fr; overflow: auto; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; line-height: 1.65; background: linear-gradient(90deg, rgba(56, 189, 248, .04), transparent 22%); }
      .gutter { padding: 14px 10px; color: #3f5977; text-align: right; user-select: none; border-right: 1px solid rgba(125, 211, 252, .08); }
      pre.code { margin: 0; padding: 14px 18px; white-space: pre; color: #dbeafe; }
      .kw { color: #7dd3fc; } .str { color: #86efac; } .fn { color: #f0abfc; }
      .right { display: grid; grid-template-rows: 46% 27% 27%; }
      .preview-frame { width: 100%; height: 100%; border: 0; background: #020617; }
      .runtime-card { padding: 12px; }
      .metric-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 28px; border-bottom: 1px solid rgba(125, 211, 252, .08); color: var(--muted); font-size: 12px; }
      .metric-row strong { color: var(--text); font-weight: 700; }
      .pass { color: var(--green) !important; } .warn { color: var(--yellow) !important; } .fail, .error { color: var(--red) !important; }
      .bottom { display: grid; grid-template-columns: 180px minmax(0, 1fr); min-height: 0; background: var(--panel); }
      .bottom-tabs { border-right: 1px solid var(--line); background: #070d18; padding: 8px; }
      .bottom-tabs div { height: 28px; display: flex; align-items: center; padding: 0 10px; color: var(--muted); font-size: 12px; }
      .bottom-tabs .active { color: var(--text); background: rgba(56, 189, 248, .12); box-shadow: inset 2px 0 var(--cyan); }
      .bottom-content { min-height: 0; overflow: auto; padding: 10px 14px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; color: #c8ddf3; }
      .diagnostics li, .recommendations li { display: grid; gap: 4px; padding: 8px 0; border-bottom: 1px solid rgba(125, 211, 252, .08); }
      .recommendations strong { color: #e5f2ff; }
      .recommendations span { color: var(--muted); line-height: 1.4; }
      @media (max-width: 980px) { body { overflow: auto; } .shell { height: auto; min-height: 100vh; grid-template-rows: auto auto auto 32px; } .navbar { flex-wrap: wrap; height: auto; padding: 10px; } .workspace { grid-template-columns: 1fr; } .sidebar, .right { grid-template-rows: auto; } .bottom { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="navbar">
        <span class="brand"><span class="logo"></span>Fastium Playground</span>
        <span class="status-pill">${renderStatusDot(state.runtime.status)}Runtime ${state.runtime.status}</span>
        <span class="status-pill">${renderStatusDot(hmrStatus)}HMR ${state.runtime.hmrPackets}</span>
        <span class="status-pill">${renderStatusDot(buildStatus)}Build ${buildStatus}</span>
        <span class="status-pill">Memory ${state.runtime.memoryMb.toFixed(2)}MB</span>
        <span class="status-pill">WS ${state.runtime.websocketLatencyMs.toFixed(3)}ms</span>
        <span class="status-pill">Native ${state.runtime.nativeTimingMs.toFixed(3)}ms</span>
      </header>
      <main class="workspace">
        <aside class="panel sidebar">
          <section><div class="section-title">Files <span>${state.files.length}</span></div><ul class="list">${state.files.map(file => `<li class="${file.path === state.activeFile ? 'file-active' : ''}"><strong>${escapeHtml(file.path)}</strong><span>${escapeHtml(file.language)}</span></li>`).join('')}</ul></section>
          <section><div class="section-title">Packages</div><ul class="list">${state.packages.map(item => `<li><strong>${escapeHtml(item)}</strong><span>internal</span></li>`).join('')}</ul></section>
          <section><div class="section-title">Module Graph</div><ul class="list">${renderGraph(state.graph)}</ul></section>
          <section><div class="section-title">Routes</div><ul class="list">${state.routes.map(route => `<li><strong>${escapeHtml(route)}</strong><span>live</span></li>`).join('')}</ul></section>
        </aside>
        <section class="panel editor">
          <div class="tabs">${state.files.map(file => `<div class="tab ${file.path === state.activeFile ? 'active' : ''}">${escapeHtml(path.basename(file.path))}</div>`).join('')}</div>
          <div class="editor-area"><div class="gutter">${(activeFile?.content ?? '').split('\n').map((_, index) => index + 1).join('<br>')}</div><pre class="code">${highlightCode(activeFile?.content ?? '')}</pre></div>
        </section>
        <aside class="panel right">
          <section><div class="section-title">Live Preview <span>responsive</span></div><iframe class="preview-frame" srcdoc="${srcdoc}"></iframe></section>
          <section class="runtime-card"><div class="section-title">Runtime Preview</div>${renderBenchmarks(state.benchmarks.slice(0, 5))}</section>
          <section><div class="section-title">Codex Recommendations</div><ul class="recommendations">${renderRecommendations(state.recommendations)}</ul></section>
        </aside>
      </main>
      <section class="bottom">
        <nav class="bottom-tabs">${['console', 'hmr', 'websocket', 'memory', 'diagnostics', 'benchmarks'].map(tab => `<div class="${state.activeBottomTab === tab ? 'active' : ''}">${tab}</div>`).join('')}</nav>
        <div class="bottom-content">${renderBottomPanel(state)}</div>
      </section>
      <footer class="statusbar"><span>Session ${state.name}</span><span>Roots ${state.testRoots.join(' | ')}</span><span>${state.runtime.lastRunAt ?? 'not run'}</span></footer>
    </div>
  </body>
</html>`;
};

const highlightCode = (source: string): string => escapeHtml(source)
  .replace(/\b(import|export|const|let|from|async|await|return|default|new)\b/g, '<span class="kw">$1</span>')
  .replace(/(&#39;[^&]*?&#39;|&quot;[^&]*?&quot;)/g, '<span class="str">$1</span>')
  .replace(/\b(createApp|defineComponent|createServer|Client|route|signal|registerSlashCommand)\b/g, '<span class="fn">$1</span>');

const renderBottomPanel = (state: PlaygroundState): string => {
  if (state.activeBottomTab === 'hmr') {
    return `<pre>${escapeHtml(JSON.stringify(state.hmrLog.slice(-20), null, 2))}</pre>`;
  }

  if (state.activeBottomTab === 'websocket') {
    return `<pre>${escapeHtml(state.websocketLog.join('\n'))}</pre>`;
  }

  if (state.activeBottomTab === 'memory') {
    return `<pre>${escapeHtml(JSON.stringify({ heapMb: state.runtime.memoryMb, nativeMs: state.runtime.nativeTimingMs, target: 'low idle CPU, low GC pressure, object reuse, typed arrays, arenas' }, null, 2))}</pre>`;
  }

  if (state.activeBottomTab === 'diagnostics') {
    return `<ul class="diagnostics">${renderDiagnostics(state.diagnostics)}</ul>`;
  }

  if (state.activeBottomTab === 'benchmarks') {
    return renderBenchmarks(state.benchmarks);
  }

  return `<pre>${escapeHtml(state.console.join('\n'))}</pre>`;
};

const buildGraphSnapshot = (files: PlaygroundFile[]): PlaygroundGraphNode[] => {
  const graph = createGraph();
  const byPath = new Map(files.map(file => [file.path, file]));
  const importPattern = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;

  for (const file of files) {
    graph.addModule(file.path);
    for (const match of file.content.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier || !(specifier.startsWith('.') || specifier.startsWith('/'))) {
        continue;
      }

      const normalized = path.normalize(path.join(path.dirname(file.path), specifier)).replace(/\\/g, '/');
      const resolved = byPath.has(normalized) ? normalized : byPath.has(`${normalized}.ts`) ? `${normalized}.ts` : byPath.has(`${normalized}.fst`) ? `${normalized}.fst` : normalized;
      graph.linkModule(file.path, resolved);
    }
  }

  return graph.entries().map(node => ({
    id: node.id.replace(/\\/g, '/'),
    imports: Array.from(node.imports).map(item => path.basename(item)),
    importedBy: Array.from(node.importedBy).map(item => path.basename(item))
  }));
};

export const createPlayground = (initialFiles: PlaygroundFile[] = defaultFiles) => {
  const state = createSignal<PlaygroundState>({
    name: randomId('playground'),
    framework: 'fastium',
    activeFile: initialFiles[0]?.path ?? 'src/main.fst',
    activeBottomTab: 'console',
    files: initialFiles,
    packages: ['fastium', 'fastium/compiler', 'fastium/runtime', 'fastium/hmr', 'fastium/websocket', 'fastium/discord'],
    routes: ['/', '/state', '/health', '/__fastium/playground', '/__fastium/playground/report'],
    graph: buildGraphSnapshot(initialFiles),
    console: ['Fastium package loaded from internal source runtime.', 'Playground lab is ready.'],
    diagnostics: [],
    hmrLog: [],
    websocketLog: [],
    benchmarks: [],
    recommendations: [],
    testRoots: ['testing-lab/frontend-test', 'testing-lab/backend-test', 'testing-lab/discord-test', 'testing-lab/websocket-test', 'testing-lab/frontend-build-test'],
    runtime: defaultRuntime(),
    previewHtml: createPreviewHtml()
  });
  const compiler = createCompiler();

  const patchState = (updater: (current: PlaygroundState) => PlaygroundState) => {
    state.update(current => {
      const next = updater(current);
      return {
        ...next,
        graph: buildGraphSnapshot(next.files),
        recommendations: detectRecommendations(next)
      };
    });
  };

  const runValidation = async (context: PlaygroundValidationContext = {}): Promise<PlaygroundValidationReport> => {
    const active = state.get().files.find(file => file.path === state.get().activeFile) ?? state.get().files[0];
    const diagnostics: PlaygroundDiagnostic[] = [];
    const benchmarks: PlaygroundBenchmark[] = [];
    const hmrLog: HmrPacket[] = [];
    const websocketLog: string[] = [];
    const validationCompiler = context.compiler ?? compiler;
    const validationSandbox = context.sandbox ?? createSandbox({ timeoutMs: 250 });
    let compiled: CompilationResult | undefined;

    patchState(current => ({
      ...current,
      runtime: { ...current.runtime, status: 'running', memoryMb: memoryMb() },
      console: [...current.console, `Validation started for ${active?.path ?? '<none>'}`].slice(-200)
    }));

    try {
      benchmarks.push(await benchmark('compiler', async () => {
        compiled = await validationCompiler.compileSource(active?.content ?? '', { filePath: active?.path });
      }));
      diagnostics.push(diagnostic('compiler', compiled?.diagnostics.length ? 'warn' : 'info', compiled?.diagnostics.length ? `${compiled.diagnostics.length} compiler diagnostics` : `compiled ${active?.path ?? '<memory>'}`));

      benchmarks.push(await benchmark('sandbox runtime', async () => {
        await validationSandbox.runModule('module.exports = { ok: true, package: "fastium" };', { filename: 'playground-runtime.js', timeoutMs: 250 });
      }));
      diagnostics.push(diagnostic('sandbox', 'info', 'sandbox executed isolated package validation module'));

      benchmarks.push(await benchmark('frontend render', async () => {
        const app = createApp();
        const Shell = defineComponent('PlaygroundShell', () => '<main>Fastium package preview</main>');
        app.route('/', () => Shell);
        await app.render(Shell);
      }));
      diagnostics.push(diagnostic('runtime', 'info', 'frontend runtime rendered through Fastium createApp'));

      const hmrStarted = performance.now();
      const remembered = context.hmr?.remember('playground:active', { file: active?.path, timestamp: Date.now() });
      void remembered;
      const updatePacket = context.hmr?.update('playground:active', { code: compiled?.code ?? '', hash: compiled?.hash });
      const invalidatePacket = context.hmr?.invalidate('playground:active', { reason: 'playground-validation' });
      if (updatePacket) hmrLog.push(updatePacket);
      if (invalidatePacket) hmrLog.push(invalidatePacket);
      const hmrMs = performance.now() - hmrStarted;
      benchmarks.push({ name: 'hmr patch', durationMs: Number(hmrMs.toFixed(3)), targetMs: TARGET_MS, status: benchmarkStatus(hmrMs) });
      diagnostics.push(diagnostic('hmr', 'info', `generated ${hmrLog.length} real HMR packets`));

      benchmarks.push(await benchmark('websocket frame', async () => {
        const frame = encodeWebSocketFrame(compiled?.hash ?? 'fastium');
        const decoded = decodeWebSocketFrame(frame);
        if (!decoded) {
          throw new Error('websocket frame decode failed');
        }
        const decoder = new WebSocketFrameDecoder();
        decoder.push(frame);
      }));
      websocketLog.push(`accept ${createWebSocketAcceptKey('fastium-playground').slice(0, 16)}`);
      websocketLog.push(`frame ${compiled?.hash?.slice(0, 12) ?? 'no-hash'}`);
      diagnostics.push(diagnostic('websocket', 'info', 'encoded and decoded websocket frame with real Fastium websocket runtime'));

      const nativeReport = await runNativeBenchmarkSuite(active?.content ?? '');
      benchmarks.push(...nativeReport.results.map(result => ({
        name: result.name,
        durationMs: result.durationMs,
        targetMs: result.targetMs,
        status: result.status
      })));
      const nativeAnalysis = analyzeCompilationNative(active?.content ?? '');
      diagnostics.push(diagnostic('native', 'info', `native scan found ${nativeAnalysis.imports.length} imports, hash ${nativeAnalysis.sourceHash}`));

      if (context.bundler?.bundle && active) {
        try {
          benchmarks.push(await benchmark('package bundle', async () => {
            await context.bundler?.bundle?.(active.path);
          }));
          diagnostics.push(diagnostic('package', 'info', 'bundler exercised through active playground entry'));
        } catch (error) {
          diagnostics.push(diagnostic('package', 'warn', error instanceof Error ? error.message : String(error)));
        }
      }

      const runtime: PlaygroundRuntimeSnapshot = {
        status: diagnostics.some(item => item.level === 'error') ? 'failed' : 'passed',
        packageName: 'fastium',
        compilerHash: compiled?.hash,
        compiledBytes: compiled?.code.length ?? 0,
        graphModules: buildGraphSnapshot(state.get().files).length,
        hmrPackets: (context.hmr?.history?.() ?? hmrLog).length,
        websocketLatencyMs: benchmarks.find(item => item.name === 'websocket frame')?.durationMs ?? 0,
        nativeTimingMs: nativeReport.totalMs,
        memoryMb: memoryMb(),
        lastRunAt: new Date().toISOString()
      };

      patchState(current => ({
        ...current,
        diagnostics: [...diagnostics, ...current.diagnostics].slice(0, 120),
        benchmarks,
        hmrLog: [...current.hmrLog, ...hmrLog, ...(context.hmr?.history?.() ?? [])].slice(-80),
        websocketLog: [...current.websocketLog, ...websocketLog].slice(-120),
        console: [...current.console, `Validation passed: ${compiled?.hash?.slice(0, 12) ?? 'no-hash'}`].slice(-200),
        runtime,
        previewHtml: createPreviewHtml(compiled?.code ?? '')
      }));

      return {
        runtime,
        diagnostics,
        benchmarks,
        recommendations: state.get().recommendations
      };
    } catch (error) {
      const runtime: PlaygroundRuntimeSnapshot = {
        ...state.get().runtime,
        status: 'failed',
        memoryMb: memoryMb(),
        lastRunAt: new Date().toISOString()
      };
      const failure = diagnostic('runtime', 'error', error instanceof Error ? error.message : String(error));
      patchState(current => ({
        ...current,
        diagnostics: [failure, ...diagnostics, ...current.diagnostics].slice(0, 120),
        benchmarks,
        runtime
      }));

      return {
        runtime,
        diagnostics: [failure, ...diagnostics],
        benchmarks,
        recommendations: state.get().recommendations
      };
    }
  };

  return {
    sessionId: state.get().name,
    state,
    openFile(filePath: string) {
      patchState(current => ({ ...current, activeFile: filePath }));
    },
    updateFile(filePath: string, content: string) {
      patchState(current => ({
        ...current,
        files: current.files.map(file => file.path === filePath ? { ...file, content } : file),
        console: [...current.console, `Edited ${filePath}`].slice(-200)
      }));
    },
    addFile(file: PlaygroundFile) {
      patchState(current => ({
        ...current,
        files: [...current.files, file],
        console: [...current.console, `Added ${file.path}`].slice(-200)
      }));
    },
    removeFile(filePath: string) {
      patchState(current => ({
        ...current,
        files: current.files.filter(file => file.path !== filePath),
        activeFile: current.activeFile === filePath ? current.files.find(file => file.path !== filePath)?.path ?? current.activeFile : current.activeFile,
        console: [...current.console, `Removed ${filePath}`].slice(-200)
      }));
    },
    log(message: string) {
      patchState(current => ({
        ...current,
        console: [...current.console, message].slice(-200)
      }));
    },
    report(message: string) {
      patchState(current => ({
        ...current,
        diagnostics: [diagnostic('runtime', 'warn', message), ...current.diagnostics].slice(0, 100)
      }));
    },
    recommend(): PlaygroundRecommendation[] {
      const recommendations = detectRecommendations(state.get());
      patchState(current => ({ ...current, recommendations }));
      return recommendations;
    },
    async runValidation(context?: PlaygroundValidationContext) {
      return runValidation(context);
    },
    snapshot(): PlaygroundState {
      return state.get();
    },
    renderHtml() {
      return createShellHtml(state.get());
    }
  };
};
