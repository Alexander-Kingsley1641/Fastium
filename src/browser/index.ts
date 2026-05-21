import { spawn } from 'node:child_process';
import process from 'node:process';

import { createLogger, type Logger } from '../logger/index.js';

export interface BrowserSession {
  url: string;
  openedAt: number;
  diagnosticsEnabled: boolean;
  hmrEnabled: boolean;
}

export interface BrowserBridgeOptions {
  logger?: Logger;
}

export interface BrowserInspectorState {
  server?: Record<string, unknown>;
  graph?: Record<string, unknown>;
  hmr?: unknown[];
  memory?: NodeJS.MemoryUsage;
  websocket?: Record<string, unknown>;
}

const openExternalUrl = async (url: string): Promise<void> => {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
};

export const createBrowserBridge = (options: BrowserBridgeOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:browser', debug: false });
  const sessions = new Map<string, BrowserSession>();

  const open = async (url: string, diagnosticsEnabled = true, hmrEnabled = true): Promise<BrowserSession> => {
    await openExternalUrl(url);
    const session: BrowserSession = {
      url,
      openedAt: Date.now(),
      diagnosticsEnabled,
      hmrEnabled
    };

    sessions.set(url, session);
    logger.info('opened browser', url);
    return session;
  };

  return {
    open,
    sessions,
    attach: (url: string) => sessions.get(url),
    close: (url: string) => {
      sessions.delete(url);
    },
    renderInspector(state: BrowserInspectorState = {}) {
      const memory = state.memory;
      const graph = state.graph ?? {};
      const hmr = state.hmr ?? [];
      return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fastium Browser</title>
    <style>
      :root { color-scheme: dark; --bg: #05070b; --panel: #0d1420; --line: #223047; --text: #e5edf8; --muted: #8aa0bb; --accent: #38bdf8; --ok: #22c55e; --warn: #f59e0b; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; }
      header, footer { height: 44px; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: #080d15; border-bottom: 1px solid var(--line); }
      footer { border-top: 1px solid var(--line); border-bottom: 0; color: var(--muted); }
      main { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 1px; min-height: calc(100vh - 88px); background: var(--line); }
      section { background: var(--panel); padding: 16px; min-width: 0; overflow: auto; }
      h2 { margin: 0 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
      .metric { display: flex; justify-content: space-between; gap: 16px; padding: 10px 0; border-bottom: 1px solid rgba(138, 160, 187, .14); }
      pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #c7d7ee; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
      .brand { font-weight: 700; }
    </style>
  </head>
  <body>
    <header><span class="brand">Fastium Browser</span><span>${new Date().toISOString()}</span></header>
    <main>
      <section><h2>Server</h2><pre>${escapeHtml(JSON.stringify(state.server ?? {}, null, 2))}</pre></section>
      <section><h2>Module Graph</h2><div class="metric"><span>Modules</span><strong>${String(graph.modules ?? 0)}</strong></div><div class="metric"><span>Cycles</span><strong>${Array.isArray(graph.cycles) ? graph.cycles.length : 0}</strong></div><pre>${escapeHtml(JSON.stringify(graph.cache ?? {}, null, 2))}</pre></section>
      <section><h2>HMR</h2><div class="metric"><span>Packets</span><strong>${hmr.length}</strong></div><pre>${escapeHtml(JSON.stringify(hmr.slice(-12), null, 2))}</pre></section>
      <section><h2>Memory</h2><pre>${escapeHtml(JSON.stringify(memory ? { heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, rss: memory.rss, external: memory.external } : {}, null, 2))}</pre></section>
    </main>
    <footer><span>WebSocket inspector at /fastium-hmr</span><span>Graph JSON at /__fastium/graph</span></footer>
  </body>
</html>`;
    }
  };
};

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
