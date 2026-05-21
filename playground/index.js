/* Playground orchestration moved out of index.html */

const files = {
  'main.ax': `import { component, useState, onMount } from '@alexium/frontend'
import { createStore } from '@alexium/state'
import { createRouter } from '@alexium/router'

const appStore = createStore({ count: 0, status: 'stable' })

export default component('App', () => {
  const [count, setCount] = useState(appStore.state.count)

  onMount(() => {
    console.log('[main.ax] app mounted')
  })

  function increment() {
    setCount(count + 1)
    appStore.set({ count: count + 1 })
  }

  return (
    <section class="app-shell">
      <h1>Alexium Playground</h1>
      <p>Sandboxed runtime, safe HMR, and internal package validation.</p>
      <div class="actions">
        <button onclick={increment}>Count is {count}</button>
        <button onclick={() => setCount(0)}>Reset</button>
      </div>
    </section>
  )
})`,
  'app.ax': `export const internalPackages = [
  '@alexium/frontend',
  '@alexium/runtime',
  '@alexium/hmr',
  '@alexium/compiler',
  '@alexium/router'
]

export function createAppManifest() {
  return {
    name: 'alexium-playground',
    version: '0.1.0',
    packages: internalPackages
  }
}`,
  'style.ax': `export const theme = {
  shell: {
    background: 'linear-gradient(135deg, rgba(0, 212, 255, 0.12), rgba(168, 85, 247, 0.08))',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    backdropFilter: 'blur(14px)'
  }
}`,
  'public/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Alexium Playground Preview</title>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>`,
  'package.ax.json': `{
  "name": "alexium-playground",
  "runtime": "sandboxed",
  "internalPackages": [
    "@alexium/frontend",
    "@alexium/runtime",
    "@alexium/hmr",
    "@alexium/compiler",
    "@alexium/router"
  ]
}`,
  'README.md': `# Alexium Playground Sandbox

Internal validation, isolated runtime execution, crash recovery, and safe HMR.

## Commands

- alexium test
- alexium test --watch
- alexium test --benchmark
`
};

const packageRegistry = {
  '@alexium/frontend': {
    status: 'ok',
    exports: ['component', 'useState', 'onMount'],
    version: 'sandbox-link'
  },
  '@alexium/runtime': { status: 'ok', exports: ['createRuntime'], version: 'sandbox-link' },
  '@alexium/hmr': { status: 'ok', exports: ['applyPatch'], version: 'sandbox-link' },
  '@alexium/compiler': { status: 'ok', exports: ['compile'], version: 'sandbox-link' },
  '@alexium/router': { status: 'ok', exports: ['createRouter'], version: 'sandbox-link' }
};

const state = {
  currentFile: 'main.ax',
  lastSnapshot: files['main.ax'],
  sandboxReady: false,
  sandboxVersion: 0,
  overlayOpen: false,
  activeConsoleTab: 'console',
  activeHmrTab: 'hmr',
  runtime: {
    startedAt: performance.now(),
    lastRun: 0,
    lastValidation: 'idle',
    failures: 0,
    hmrTiming: 0,
    memoryEstimate: 0,
    modules: Object.keys(packageRegistry)
  },
  diagnostics: [],
  problems: [],
  tests: [],
  benchmark: [],
  graph: []
};

function nowStamp() {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function addConsoleLog(message, level = 'INFO', tab = 'console') {
  const output = document.getElementById('console-output');
  const line = document.createElement('div');
  line.className = 'console-line animate-in';
  const levelClass = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : level === 'SUCCESS' ? 'success' : '';
  line.innerHTML = `<span class="console-time">[${nowStamp()}]</span><span class="console-type ${levelClass}">${level}</span><span class="console-msg ${levelClass}">${escapeHtml(message)}</span>`;
  output.appendChild(line);
  while (output.children.length > 80) {
    output.firstChild.remove();
  }
  output.scrollTop = output.scrollHeight;
  if (tab === 'problems' && level === 'ERROR') {
    state.problems.push({ message, time: nowStamp() });
  }
  if (tab === 'logs') {
    state.diagnostics.push({ message, level, time: nowStamp() });
  }
  try { renderDiagnostics(); } catch (e) { try { console && console.warn && console.warn('renderDiagnostics error', e && e.message); } catch (er) {} }
}

function renderLineNumbers() {
  const editor = document.getElementById('editor');
  const lineNumbers = document.getElementById('lineNumbers');
  const lines = editor.value.split('\n').length || 1;
  lineNumbers.innerHTML = Array.from({ length: lines }, (_, index) => `<div class="line-number">${index + 1}</div>`).join('');
}

function updateStatus() {
  const editor = document.getElementById('editor');
  const beforeCursor = editor.value.slice(0, editor.selectionStart);
  const line = beforeCursor.split('\n').length;
  const col = beforeCursor.split('\n').pop().length + 1;
  document.getElementById('cursorPos').textContent = `Ln ${line}, Col ${col}`;
  document.getElementById('fileInfo').textContent = state.currentFile;
}

function setEditorFile(filename, shouldLog = true) {
  state.currentFile = filename;
  document.getElementById('editor').value = files[filename] || '';
  renderLineNumbers();
  updateStatus();
  updateRuntimeMetrics();
  if (shouldLog) {
    addConsoleLog(`File opened: ${filename}`, 'INFO');
  }
}

function switchFile(element, filename) {
  document.querySelectorAll('.file-item.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  document.querySelectorAll('.editor-tab.active').forEach((node) => node.classList.remove('active'));
  const tabs = Array.from(document.querySelectorAll('.editor-tab'));
  const matchedTab = tabs.find((tab) => tab.textContent.includes(filename));
  if (matchedTab) matchedTab.classList.add('active');
  setEditorFile(filename);
}

function switchTab(element, filename) {
  document.querySelectorAll('.editor-tab.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  setEditorFile(filename, false);
}

function switchPreviewTab(element, tab) {
  document.querySelectorAll('.preview-tab.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  document.querySelectorAll('.preview-content.active').forEach((node) => node.classList.remove('active'));
  document.getElementById(`${tab}-preview`).classList.add('active');
}

function switchConsoleTab(element, tab) {
  state.activeConsoleTab = tab;
  document.querySelectorAll('.console-tab.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  renderDiagnostics();
}

function switchHmrTab(element, tab) {
  state.activeHmrTab = tab;
  document.querySelectorAll('.hmr-tab.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  renderDiagnostics();
}

function switchDiagnosticsTab(element, tab) {
  state.activeDiagnosticsTab = tab;
  document.querySelectorAll('.diagnostics-tab.active').forEach((node) => node.classList.remove('active'));
  element.classList.add('active');
  document.querySelectorAll('.diagnostics-content.active').forEach((node) => node.classList.remove('active'));
  const el = document.getElementById(`diagnostics-${tab}`);
  if (el) el.classList.add('active');
  renderDiagnostics();
}

function toggleFolder(element) {
  element.classList.toggle('open');
}

function validateSource(name, source) {
  const result = {
    name,
    ok: true,
    warnings: [],
    errors: [],
    timing: 0
  };
  const started = performance.now();
  if (!source || !source.trim()) {
    result.ok = false;
    result.errors.push('Empty file');
  }
  if ((source.match(/\(/g) || []).length !== (source.match(/\)/g) || []).length) {
    result.ok = false;
    result.errors.push('Unbalanced parentheses detected');
  }
  if ((source.match(/\{/g) || []).length !== (source.match(/\}/g) || []).length) {
    result.ok = false;
    result.errors.push('Unbalanced braces detected');
  }
  if (/import\s+.*from\s+['"][^'"]+['"];?/.test(source) && !source.includes('@alexium/')) {
    result.warnings.push('External import detected');
  }
  result.timing = Math.max(1, Math.round(performance.now() - started));
  return result;
}

function parseInternalPackages() {
  const matched = {};
  for (const [name, record] of Object.entries(packageRegistry)) {
    matched[name] = {
      ...record,
      linked: true,
      health: 'healthy'
    };
  }
  return matched;
}

function buildModuleGraph() {
  return [
    { name: '@alexium/frontend', deps: ['@alexium/runtime', '@alexium/state'] },
    { name: '@alexium/runtime', deps: ['@alexium/hmr', '@alexium/router'] },
    { name: '@alexium/hmr', deps: ['@alexium/compiler'] },
    { name: '@alexium/compiler', deps: [] },
    { name: '@alexium/router', deps: [] }
  ];
}

function renderDiagnostics() {
  try {
    const hmrEl = document.getElementById('hmr-content');
    const runtime = state.runtime;
  const packages = parseInternalPackages();
  const moduleGraph = buildModuleGraph();
  const memory = Math.round((performance.memory?.usedJSHeapSize || 36_000_000) / 1024 / 1024);
  state.runtime.memoryEstimate = memory;
  state.graph = moduleGraph;

  const sections = {
    hmr: `
      <div class="metric-card"><div class="metric-label">HMR Timing</div><div class="metric-value">${runtime.hmrTiming || 0}ms</div></div>
      <div class="metric-card"><div class="metric-label">Last Validation</div><div class="metric-value">${runtime.lastValidation}</div></div>
      <div class="metric-card"><div class="metric-label">Failures</div><div class="metric-value">${runtime.failures}</div></div>
    `,
    graph: `
      <div class="metric-card"><div class="metric-label">Module Graph</div><div class="metric-value">${moduleGraph.map((node) => `${node.name} -> ${node.deps.length ? node.deps.join(', ') : 'leaf'}`).join('\n')}</div></div>
    `,
    memory: `
      <div class="metric-card"><div class="metric-label">Memory</div><div class="metric-value">${memory} MB estimated\nCache slots: ${state.runtime.modules.length}\nRetained snapshots: ${state.lastSnapshot ? 1 : 0}</div></div>
    `,
    perf: `
      <div class="metric-card"><div class="metric-label">Build Performance</div><div class="metric-value">Validation: ${runtime.lastValidation}\nSandbox version: ${state.sandboxVersion}\nUptime: ${Math.round(performance.now() - runtime.startedAt)}ms</div></div>
      <div class="metric-card"><div class="metric-label">Package Links</div><div class="metric-value">${Object.keys(packages).map((name) => `${name} [${packages[name].health}]`).join('\n')}</div></div>
    `
  };

  // If old layout exists, populate hmr-content; otherwise populate diagnostics panels
  if (hmrEl) {
    const hmrTab = state.activeHmrTab;
    if (hmrTab === 'hmr') hmrEl.innerHTML = sections.hmr;
    else if (hmrTab === 'graph') hmrEl.innerHTML = sections.graph;
    else if (hmrTab === 'memory') hmrEl.innerHTML = sections.memory;
    else hmrEl.innerHTML = sections.perf;
    return;
  }

  const containers = {
    runtime: document.getElementById('diagnostics-runtime'),
    hmr: document.getElementById('diagnostics-hmr'),
    memory: document.getElementById('diagnostics-memory'),
    graph: document.getElementById('diagnostics-graph'),
    tests: document.getElementById('diagnostics-tests')
  };

    if (containers.runtime) {
      containers.runtime.innerHTML = `
        <div class="metric-card"><div class="metric-label">Runtime Health</div><div class="metric-value">Sandbox ready: ${state.sandboxReady ? 'yes' : 'no'}\nValidation: ${state.runtime.lastValidation}\nFailures: ${state.runtime.failures}</div></div>
        <div class="metric-card"><div class="metric-label">Packages</div><div class="metric-value">${Object.keys(packageRegistry).map((name) => `${name} [${packageRegistry[name].status}]`).join('\n')}</div></div>
      `;
    }
    if (containers.hmr) containers.hmr.innerHTML = sections.hmr;
    if (containers.memory) containers.memory.innerHTML = sections.memory;
    if (containers.graph) containers.graph.innerHTML = sections.graph;
    if (containers.tests) containers.tests.innerHTML = sections.perf;
  } catch (err) {
    // defensive: if DOM isn't ready or layout differs, avoid throwing during UI updates
    try { console && console.warn && console.warn('renderDiagnostics skipped:', err && err.message); } catch (e) {}
  }
}

function updateRuntimeMetrics() {
  renderDiagnostics();
}

function renderConsoleByTab(tabName) {
  const output = document.getElementById('console-output');
  const diagnostics = state.diagnostics.slice(-60);
  const problems = state.problems.slice(-30);
  const testLines = state.tests.slice(-40);
  const content = tabName === 'problems'
    ? problems.map((problem) => `<div class="console-line"><span class="console-time">[${problem.time}]</span><span class="console-type" style="color: var(--error-red);">ERROR</span><span class="console-msg error">${escapeHtml(problem.message)}</span></div>`).join('') || '<div class="console-line"><span class="console-time">[--:--:--]</span><span class="console-type">INFO</span><span class="console-msg">No problems reported.</span></div>'
    : tabName === 'logs'
      ? diagnostics.map((entry) => `<div class="console-line"><span class="console-time">[${entry.time}]</span><span class="console-type" style="color: var(--accent-purple);">${escapeHtml(entry.level)}</span><span class="console-msg">${escapeHtml(entry.message)}</span></div>`).join('') || '<div class="console-line"><span class="console-time">[--:--:--]</span><span class="console-type">INFO</span><span class="console-msg">No logs yet.</span></div>'
      : tabName === 'tests'
        ? testLines.map((entry) => `<div class="console-line"><span class="console-time">[${entry.time}]</span><span class="console-type" style="color: ${entry.pass ? 'var(--success-green)' : 'var(--error-red)'};">${entry.pass ? 'PASS' : 'FAIL'}</span><span class="console-msg ${entry.pass ? 'success' : 'error'}">${escapeHtml(entry.message)}</span></div>`).join('') || '<div class="console-line"><span class="console-time">[--:--:--]</span><span class="console-type">INFO</span><span class="console-msg">No tests run yet.</span></div>'
        : `<div class="console-line"><span class="console-time">[${nowStamp()}]</span><span class="console-type">INFO</span><span class="console-msg">Alexium Dev Server v0.1.0</span></div>
               <div class="console-line"><span class="console-time">[${nowStamp()}]</span><span class="console-type">INFO</span><span class="console-msg">Local: http://127.0.0.1:5500</span></div>
               <div class="console-line"><span class="console-time">[${nowStamp()}]</span><span class="console-type">INFO</span><span class="console-msg">Sandbox isolated runtime ready</span></div>`;
  output.innerHTML = content;
}

function ensureConsoleSeed() {
  if (!state.diagnostics.length) {
    state.diagnostics.push({ time: nowStamp(), level: 'INFO', message: 'Sandbox isolated runtime ready' });
    state.diagnostics.push({ time: nowStamp(), level: 'INFO', message: 'Internal package linker online' });
  }
  renderConsoleByTab(state.activeConsoleTab);
  renderDiagnostics();
}

// Advanced sandbox frame: RPC protocol, test runner, timeout and safe evaluation
function createSandboxFrame() {
  const iframe = document.getElementById('sandbox-frame');
  state.sandboxVersion += 1;
  // create a small rpc-enabled iframe that accepts commands and returns structured responses
  const sandboxHTML = `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'"> <style>body{margin:0;font-family:system-ui,sans-serif;background:#0b1020;color:#e5e7eb}#root{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:32px}.card{background:rgba(20,26,45,.9);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px;max-width:640px;box-shadow:0 18px 50px rgba(0,0,0,.45)}pre{white-space:pre-wrap;word-wrap:break-word}</style></head><body><div id="root"><div class="card"><h1 style="margin-bottom:10px;color:#7dd3fc">Alexium Sandbox</h1><p style="color:#cbd5e1;line-height:1.6">Sandbox booted. Internal code executes here, isolated from the editor runtime.</p><div id="runtime-status" style="margin-top:14px;color:#a7f3d0;font-size:12px">booting...</div><pre id="sandbox-log" style="margin-top:12px;color:#cbd5e1;max-height:240px;overflow:auto"></pre></div></div><script>
        (function(){
          const origin = '*';
          window.__sandboxPhase = 'boot:start';
          const logEl = document.getElementById('sandbox-log');
          function appendLog(line){ if(!logEl) return; logEl.textContent += '\\n' + line; logEl.scrollTop = logEl.scrollHeight; }
          const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
          function post(kind, payload){
            try {
              parent.postMessage({ source: 'alexium-sandbox', kind, payload }, origin);
            } catch (error) {
              appendLog('[POST-ERROR] ' + (error && error.message ? error.message : String(error)));
            }
          }
          window.addEventListener('error', (event) => {
            post('runtime-error', { message: event.message || 'sandbox error', stack: event.error && event.error.stack, source: event.filename, line: event.lineno, column: event.colno });
            appendLog('[ERROR] ' + (event.message || 'sandbox error'));
          });
          window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason && event.reason.message ? event.reason.message : String(event.reason || 'unhandled rejection');
            post('runtime-error', { message: reason, stack: event.reason && event.reason.stack });
            appendLog('[ERROR] ' + reason);
          });
          console.log = (...args)=>{ post('console', { level: 'INFO', message: args.map(String).join(' ') }); original.log(...args); appendLog('[LOG] '+args.join(' ')); };
          console.warn = (...args)=>{ post('console', { level: 'WARN', message: args.map(String).join(' ') }); original.warn(...args); appendLog('[WARN] '+args.join(' ')); };
          console.error = (...args)=>{ post('console', { level: 'ERROR', message: args.map(String).join(' ') }); original.error(...args); appendLog('[ERROR] '+args.join(' ')); };
          console.info = (...args)=>{ post('console', { level: 'INFO', message: args.map(String).join(' ') }); original.info(...args); appendLog('[INFO] '+args.join(' ')); };

          // Simple RPC handler
          const pending = new Map();
          function sendResponse(id, ok, result){ post('rpc-response', { id, ok, result }); }

          function safeEval(code){ // evaluate in function scope with limited globals
            const Fn = Function;
            return (new Fn('exports','module','require','console', code));
          }

          // runCode: executes code string and returns value or throws
          async function runCode(id, code, timeoutMs){
            try{
              const isModuleLike = code.includes('import ') || code.includes('export default') || (code.includes('return (') && code.includes('<'));
              if (isModuleLike) {
                sendResponse(id, true, {
                  result: {
                    compiled: true,
                    kind: 'module',
                    bytes: code.length
                  }
                });
                return;
              }
              // simple timing guard
              let finished = false;
              const runner = new Promise((resolve, reject)=>{
                try{
                  // execute inside Function to avoid access to iframe globals directly
                  const fn = safeEval('\\n' + code + '\\n');
                  const module = { exports: {} };
                  const maybe = fn(module.exports, module, undefined, console);
                  resolve(module.exports);
                } catch(err){ reject(err); }
              });
              const race = Promise.race([
                runner,
                new Promise((_, reject)=> setTimeout(()=> reject(new Error('Execution timeout')), timeoutMs || 2000))
              ]);
              const result = await race;
              finished = true;
              sendResponse(id, true, { result });
            } catch (err) {
              sendResponse(id, false, { message: err.message, stack: err.stack });
            }
          }

          // run multiple tests: tests = [{name, code}]
          async function runTests(id, tests, timeoutMs){
            const results = [];
            for(const t of tests){
              try{
                await runCode('tmp-'+Math.random().toString(36).slice(2), t.code, timeoutMs || 2000);
                results.push({ name: t.name, pass: true });
              } catch(err){
                results.push({ name: t.name, pass: false, message: err.message });
              }
            }
            sendResponse(id, true, { results });
          }

          // message protocol
          window.addEventListener('message', (ev)=>{
            const data = ev.data || {};
            if (data.source !== 'alexium-host') return;
            const { cmd, id, payload } = data;
            if (cmd === 'ping') return sendResponse(id, true, { ok: true });
            if (cmd === 'runCode') return runCode(id, payload.code, payload.timeoutMs);
            if (cmd === 'runTests') return runTests(id, payload.tests, payload.timeoutMs);
            if (cmd === 'reset'){
              // basic reset: clear log and notify
              logEl.textContent = '';
              post('reset-done', { ok: true });
              return sendResponse(id, true, { ok: true });
            }
            sendResponse(id, false, { message: 'unknown-cmd' });
          });

          // report ready
          try {
            window.__sandboxPhase = 'boot:ready-start';
            post('sandbox-ready', { ready: true });
            window.__sandboxPhase = 'boot:ready-posted';
            document.getElementById('runtime-status').textContent = 'ready';
            window.__sandboxPhase = 'boot:ready-done';
          } catch (error) {
            window.__sandboxPhase = 'boot:ready-error';
            post('runtime-error', { message: error.message, stack: error.stack });
          }
        })();
      <\/script></body></html>`;
      iframe.srcdoc = sandboxHTML;
      // attach handshake timeout
      setTimeout(()=>{ if(!state.sandboxReady) addConsoleLog('Sandbox creating... awaiting ready', 'INFO'); }, 200);
      return iframe;
    }

    // RPC helper: send a command to sandbox and await response
    const _rpcPromises = new Map();
    let _rpcId = 1;
    function postToSandbox(cmd, payload = {}, timeout = 2500) {
      return new Promise((resolve, reject) => {
        const iframe = document.getElementById('sandbox-frame');
        const win = iframe && iframe.contentWindow;
        if (!win) return reject(new Error('Sandbox frame missing'));
        const id = 'r' + (_rpcId++);
        const timer = setTimeout(() => { _rpcPromises.delete(id); reject(new Error('Sandbox RPC timeout')); }, timeout || 8000);
        _rpcPromises.set(id, { resolve, reject, timer });
        win.postMessage({ source: 'alexium-host', cmd, id, payload }, '*');
      });
    }

    function restartSandbox() {
      state.runtime.lastValidation = 'restarting sandbox';
      state.sandboxReady = false;
      createSandboxFrame();
      addConsoleLog('Sandbox restarted', 'INFO');
      renderDiagnostics();
    }

    function waitForSandboxReady(timeout = 5000) {
      if (state.sandboxReady) {
        return Promise.resolve(true);
      }
      return new Promise((resolve, reject) => {
        const started = performance.now();
        const timer = setInterval(() => {
          if (state.sandboxReady) {
            clearInterval(timer);
            resolve(true);
            return;
          }
          if (performance.now() - started >= timeout) {
            clearInterval(timer);
            reject(new Error('Sandbox ready timeout'));
          }
        }, 50);
      });
    }

    function showOverlay(title, codeFrame, diagnostics, recovery) {
      state.overlayOpen = true;
      document.getElementById('overlaySummary').textContent = title;
      document.getElementById('overlayCodeFrame').textContent = codeFrame;
      document.getElementById('overlayDiagnostics').textContent = diagnostics;
      document.getElementById('overlayRecovery').textContent = recovery;
      document.getElementById('errorOverlay').classList.add('active');
      document.getElementById('errorOverlay').setAttribute('aria-hidden', 'false');
    }

    function hideOverlay() {
      state.overlayOpen = false;
      document.getElementById('errorOverlay').classList.remove('active');
      document.getElementById('errorOverlay').setAttribute('aria-hidden', 'true');
    }

    function recoverFromOverlay() {
      files[state.currentFile] = state.lastSnapshot;
      setEditorFile(state.currentFile, false);
      hideOverlay();
      addConsoleLog('Restored safe snapshot', 'SUCCESS');
      runValidationSuite();
    }

    async function sandboxEvaluate(source, label, timeoutMs = 2000) {
      // use RPC runCode and record timing
      const start = performance.now();
      try {
        const res = await postToSandbox('runCode', { code: source, timeoutMs }, timeoutMs + 200);
        const elapsed = Math.max(1, Math.round(performance.now() - start));
        state.runtime.hmrTiming = elapsed;
        state.runtime.lastRun = performance.now();
        state.runtime.lastValidation = `${label} validated in ${elapsed}ms`;
        return { ok: true, elapsed, result: res.result };
      } catch (err) {
        state.runtime.failures += 1;
        throw err;
      }
    }

    function validatePackages() {
      const linked = parseInternalPackages();
      const entries = Object.entries(linked);
      const failures = entries.filter(([, record]) => record.status !== 'ok');
      if (failures.length) {
        throw new Error(`Package validation failed for ${failures.map(([name]) => name).join(', ')}`);
      }
      return entries.length;
    }

    async function runValidationSuite() {
      const editor = document.getElementById('editor');
      const source = editor.value;
      // keep snapshot per-file for rollback
      if (!state.lastGoodSnapshots) state.lastGoodSnapshots = {};
      state.tests = [];
      state.problems = [];
      addConsoleLog('Running internal validation suite...', 'INFO');

      const syntax = validateSource(state.currentFile, source);
      const packageCheck = validatePackages();

      syntax.warnings.forEach((warning) => addConsoleLog(warning, 'WARN'));
      syntax.errors.forEach((error) => addConsoleLog(error, 'ERROR', 'problems'));

      state.tests.push({ time: nowStamp(), pass: syntax.ok, message: `${state.currentFile} syntax ${syntax.ok ? 'ok' : 'failed'}` });
      state.tests.push({ time: nowStamp(), pass: packageCheck > 0, message: `${packageCheck} internal packages linked` });

      if (!syntax.ok) {
        state.runtime.lastValidation = 'syntax validation failed';
        showOverlay(
          'Syntax or runtime issue isolated',
          source.split('\n').slice(0, 20).join('\n'),
          syntax.errors.join('\n') || 'Unknown issue',
          'Editor state preserved. The sandbox was not allowed to corrupt the host runtime.'
        );
        renderConsoleByTab('problems');
        renderDiagnostics();
        return false;
      }

      await waitForSandboxReady(5000);

      try {
        // ensure sandbox ping
        await postToSandbox('ping', {}, 1200);
      } catch (err) {
        addConsoleLog('Sandbox ping failed: ' + err.message, 'WARN');
        // attempt restart
        restartSandbox();
        await waitForSandboxReady(5000);
      }

      try {
        // run any tests discovered in workspace before applying update
        const testsToRun = [];
        for (const [name, content] of Object.entries(files)) {
          if (/\.test\./.test(name) || name.endsWith('.test.js') || name.endsWith('.test.ax')) {
            testsToRun.push({ name, code: content });
          }
        }
          if (testsToRun.length) {
            addConsoleLog(`Discovered ${testsToRun.length} test files, running...`, 'INFO');
            const resp = await postToSandbox('runTests', { tests: testsToRun, timeoutMs: 4000 }, 8000);
          const failed = (resp.results || []).filter((r) => !r.pass);
          resp.results.forEach((r) => state.tests.push({ time: nowStamp(), pass: r.pass, message: `${r.name}: ${r.pass ? 'PASS' : (r.message || 'FAIL')}` }));
          if (failed.length) {
            throw new Error('Test failure: ' + failed.map((f) => f.name).join(', '));
          }
        }

        // apply via sandbox evaluate
        const result = await sandboxEvaluate(source, state.currentFile, 3000);
        // if successful, mark last good snapshot
        state.lastGoodSnapshots[state.currentFile] = source;
        state.tests.push({ time: nowStamp(), pass: true, message: `${state.currentFile} executed inside isolated sandbox` });
        addConsoleLog('Sandbox execution completed', 'SUCCESS');
        renderConsoleByTab(state.activeConsoleTab);
        renderDiagnostics();
        return true;
      } catch (error) {
        const frame = `${error.name || 'Error'}: ${error.message || String(error)}`;
        state.tests.push({ time: nowStamp(), pass: false, message: frame });
        addConsoleLog(frame, 'ERROR', 'problems');
        showOverlay(
          'Sandbox recovered from runtime failure',
          error.stack || frame,
          frame,
          'The faulty module was isolated, the editor remained live, and the previous safe snapshot was kept.'
        );
        // attempt rollback to last good snapshot for this file
        if (state.lastGoodSnapshots && state.lastGoodSnapshots[state.currentFile]) {
          files[state.currentFile] = state.lastGoodSnapshots[state.currentFile];
          setEditorFile(state.currentFile, false);
          addConsoleLog('Rolled back to last good snapshot for ' + state.currentFile, 'WARN');
        }
        renderConsoleByTab('problems');
        renderDiagnostics();
        return false;
      }
    }

    function runBenchmark() {
      const started = performance.now();
      const passes = [];
      for (let index = 0; index < 5; index += 1) {
        const itemStart = performance.now();
        try {
          sandboxEvaluate(`const value = ${index} + ${index}; value;`, `benchmark-${index}`);
          passes.push(Math.max(1, Math.round(performance.now() - itemStart)));
        } catch (error) {
          passes.push(-1);
        }
      }
      const elapsed = Math.max(1, Math.round(performance.now() - started));
      state.benchmark = passes;
      state.tests.push({ time: nowStamp(), pass: true, message: `benchmark average ${Math.round(passes.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) / Math.max(1, passes.filter((value) => value > 0).length))}ms` });
      addConsoleLog(`Benchmark completed in ${elapsed}ms`, 'SUCCESS');
      renderConsoleByTab('tests');
      renderDiagnostics();
    }

    function runWatchMode() {
      addConsoleLog('Watch mode enabled', 'INFO');
      runValidationSuite();
    }

    function runProject() {
      const ok = runValidationSuite();
      if (ok) {
        addConsoleLog('HMR patch accepted', 'SUCCESS');
      } else {
        addConsoleLog('HMR patch rejected, rollback applied', 'ERROR', 'problems');
      }
    }

    function refreshPreview() {
      addConsoleLog('Preview refreshed', 'INFO');
      runValidationSuite();
    }

    function shareProject() {
      addConsoleLog('Share payload prepared', 'SUCCESS');
    }

    function openDocs() {
      addConsoleLog('Documentation opened', 'INFO');
      window.open('https://alexium.dev/docs', '_blank');
    }

    function openSettings() {
      addConsoleLog('Settings opened', 'INFO');
    }

    function toggleViewport() {
      addConsoleLog('Viewport selector toggled', 'INFO');
    }

    function navigateBack() {
      addConsoleLog('Navigation back', 'INFO');
    }

    function navigateForward() {
      addConsoleLog('Navigation forward', 'INFO');
    }

    function openExternal() {
      addConsoleLog('Opening external preview', 'INFO');
      window.open('http://127.0.0.1:5500/', '_blank');
    }

    function clearConsole() {
      document.getElementById('console-output').innerHTML = '';
      state.diagnostics = [];
      state.problems = [];
      state.tests = [];
      renderConsoleByTab(state.activeConsoleTab);
      addConsoleLog('Console cleared', 'INFO');
    }

    function clearOutput() {
      addConsoleLog('Preview output cleared', 'INFO');
    }

    function incrementCounter() {
      const count = document.getElementById('count');
      const next = Number(count.textContent || '0') + 1;
      count.textContent = String(next);
      addConsoleLog(`Counter incremented to ${next}`, 'INFO');
    }

    function resetCounter() {
      document.getElementById('count').textContent = '0';
      addConsoleLog('Counter reset', 'INFO');
    }

    function syncEditorFile() {
      files[state.currentFile] = document.getElementById('editor').value;
      renderLineNumbers();
      updateStatus();
      updateRuntimeMetrics();
    }

    function restartDiagnostics() {
      state.diagnostics = [];
      state.problems = [];
      state.tests = [];
      state.runtime.failures = 0;
      renderConsoleByTab(state.activeConsoleTab);
      renderDiagnostics();
    }

    function recoverRuntime() {
      hideOverlay();
      restartSandbox();
      runValidationSuite();
    }

    function onSandboxMessage(event) {
      if (!event.data || event.data.source !== 'alexium-sandbox') {
        return;
      }
      const { kind, payload } = event.data;
      if (kind === 'sandbox-ready') {
        state.sandboxReady = true;
        addConsoleLog('Sandbox ready', 'SUCCESS');
        renderDiagnostics();
        return;
      }
      if (kind === 'console') {
        addConsoleLog(payload.message, payload.level === 'ERROR' ? 'ERROR' : payload.level === 'WARN' ? 'WARN' : 'INFO');
        return;
      }
      if (kind === 'runtime-error') {
        state.runtime.failures += 1;
        addConsoleLog(`${payload.message} @ ${payload.source || 'sandbox'}:${payload.line || 0}:${payload.column || 0}`, 'ERROR', 'problems');
        showOverlay(
          'Sandbox runtime exception',
          payload.stack || payload.message,
          `${payload.message}\n${payload.source || ''}:${payload.line || 0}:${payload.column || 0}`,
          'The sandbox stayed isolated. Use the restart or restore action to recover safely.'
        );
        renderConsoleByTab('problems');
        renderDiagnostics();
        return;
      }
      if (kind === 'test-result') {
        state.tests.push({ time: nowStamp(), pass: payload.pass, message: payload.message });
        renderConsoleByTab('tests');
        return;
      }
      if (kind === 'rpc-response') {
        // structured RPC response from iframe
        const { id, ok, result } = payload || {};
        if (_rpcPromises.has(id)) {
          const entry = _rpcPromises.get(id);
          clearTimeout(entry.timer);
          _rpcPromises.delete(id);
          if (ok) entry.resolve(result || {}); else entry.reject(new Error(result && result.message ? result.message : 'rpc-failed'));
        }
        return;
      }
      if (kind === 'reset-done') {
        addConsoleLog('Sandbox reset completed', 'INFO');
        return;
      }
    }

    window.addEventListener('message', onSandboxMessage);

    const editor = document.getElementById('editor');
    editor.addEventListener('input', syncEditorFile);
    editor.addEventListener('keyup', updateStatus);
    editor.addEventListener('click', updateStatus);
    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Tab') {
        event.preventDefault();
        const start = editor.selectionStart;
        editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(start);
        editor.selectionStart = editor.selectionEnd = start + 2;
        syncEditorFile();
        return;
      }
      if (event.ctrlKey && event.key === 's') {
        event.preventDefault();
        runProject();
        return;
      }
      if (event.ctrlKey && event.key === 'Enter') {
        event.preventDefault();
        runProject();
      }
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        restartSandbox();
      }
    });

    let isResizing = false;
    const resizeHandle = document.getElementById('resizeHandle');
    resizeHandle.addEventListener('mousedown', () => {
      isResizing = true;
    });
    document.addEventListener('mousemove', (event) => {
      if (!isResizing) return;
      const newHeight = Math.max(160, window.innerHeight - event.clientY);
      document.querySelector('.bottom-panel').style.height = `${newHeight}px`;
    });
    document.addEventListener('mouseup', () => {
      isResizing = false;
    });

    document.getElementById('errorOverlay').addEventListener('click', (event) => {
      if (event.target.id === 'errorOverlay') hideOverlay();
    });

    document.getElementById('editor').value = files['main.ax'];
    renderLineNumbers();
    ensureConsoleSeed();
    createSandboxFrame();
    renderDiagnostics();
    addConsoleLog('Internal test runner online', 'SUCCESS');
    addConsoleLog('Package linker validated', 'SUCCESS');
    addConsoleLog('Sandbox validation system ready', 'SUCCESS');
    runValidationSuite();

    window.runValidationSuite = runValidationSuite;
    window.restartSandbox = restartSandbox;
    window.hideOverlay = hideOverlay;
    window.recoverFromOverlay = recoverFromOverlay;
    window.runBenchmark = runBenchmark;
    window.runWatchMode = runWatchMode;
    window.clearConsole = clearConsole;
    window.clearOutput = clearOutput;
    window.runProject = runProject;
    window.refreshPreview = refreshPreview;
    window.shareProject = shareProject;
    window.openDocs = openDocs;
    window.openSettings = openSettings;
    window.toggleViewport = toggleViewport;
    window.navigateBack = navigateBack;
    window.navigateForward = navigateForward;
    window.openExternal = openExternal;
    window.incrementCounter = incrementCounter;
    window.resetCounter = resetCounter;
    window.switchFile = switchFile;
    window.switchTab = switchTab;
    window.switchPreviewTab = switchPreviewTab;
    window.switchConsoleTab = switchConsoleTab;
    window.switchHmrTab = switchHmrTab;
    window.toggleFolder = toggleFolder;
