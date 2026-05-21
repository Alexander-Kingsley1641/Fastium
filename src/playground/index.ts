import { createSignal } from '../state/index.js';
import { randomId } from '../utils/random-id.js';

export interface PlaygroundFile {
  path: string;
  content: string;
  language: string;
}

export interface PlaygroundState {
  name: string;
  framework: 'fastium' | 'react' | 'vue';
  activeFile: string;
  files: PlaygroundFile[];
  console: string[];
  diagnostics: string[];
}

const defaultFiles: PlaygroundFile[] = [
  {
    path: 'main.fst',
    language: 'fst',
    content: "import { createApp } from 'fastium/frontend'\n\nconst app = createApp()\napp.route('/', () => ({ render: () => '<h1>Fastium Playground</h1>' }))\nexport default app\n"
  },
  {
    path: 'styles.css',
    language: 'css',
    content: ':root { color-scheme: dark; }'
  }
];

const createShellHtml = (state: PlaygroundState): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Fastium Playground</title>
    <style>
      :root { color-scheme: dark; --bg: #07111f; --panel: rgba(10, 18, 32, 0.88); --panel-strong: rgba(15, 25, 44, 0.98); --line: rgba(148, 163, 184, 0.18); --text: #e5eefc; --muted: #8ea4c7; --accent: #38bdf8; --accent-2: #22c55e; }
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 100%; background: radial-gradient(circle at top left, rgba(56, 189, 248, 0.15), transparent 30%), radial-gradient(circle at top right, rgba(34, 197, 94, 0.14), transparent 32%), linear-gradient(180deg, #08101e, #04070c 60%, #030409); color: var(--text); font-family: ui-sans-serif, system-ui, sans-serif; }
      body { min-height: 100vh; }
      .shell { display: grid; grid-template-rows: 56px 1fr 32px; height: 100vh; }
      .navbar, .statusbar { display: flex; align-items: center; gap: 14px; padding: 0 18px; background: var(--panel); border-bottom: 1px solid var(--line); backdrop-filter: blur(18px); }
      .statusbar { border-top: 1px solid var(--line); border-bottom: 0; justify-content: space-between; color: var(--muted); }
      .brand { font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
      .workspace { display: grid; grid-template-columns: 260px minmax(0, 1fr) 340px; min-height: 0; }
      .panel { min-height: 0; border-right: 1px solid var(--line); background: var(--panel-strong); overflow: hidden; }
      .panel:last-child { border-right: 0; }
      .section-title { padding: 14px 16px; border-bottom: 1px solid var(--line); font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
      .files, .console, .diagnostics { list-style: none; margin: 0; padding: 0; }
      .files li, .console li, .diagnostics li { padding: 10px 16px; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
      .editor, .preview { min-height: 0; }
      .editor { display: flex; flex-direction: column; }
      .editor-area { flex: 1; padding: 18px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px; line-height: 1.7; white-space: pre; overflow: auto; }
      .preview-frame { width: 100%; height: 100%; border: 0; background: white; }
      .console li { color: #d9e8ff; }
      .diagnostics li { color: #fecaca; }
    </style>
  </head>
  <body>
    <div class="shell">
      <header class="navbar"><span class="brand">Fastium</span><span>Playground</span><span>${state.activeFile}</span></header>
      <main class="workspace">
        <aside class="panel"><div class="section-title">Files</div><ul class="files">${state.files.map(file => `<li>${file.path}</li>`).join('')}</ul></aside>
        <section class="panel editor"><div class="section-title">Editor</div><div class="editor-area">${state.files.find(file => file.path === state.activeFile)?.content ?? ''}</div></section>
        <section class="panel"><div class="section-title">Preview</div><iframe class="preview-frame" srcdoc="${(state.files.find(file => file.path === state.activeFile)?.content ?? '').replace(/"/g, '&quot;')}"></iframe></section>
      </main>
      <footer class="statusbar"><span>Session ${randomId('playground')}</span><span>Console ${state.console.length}</span><span>Diagnostics ${state.diagnostics.length}</span></footer>
    </div>
  </body>
</html>`;

export const createPlayground = (initialFiles: PlaygroundFile[] = defaultFiles) => {
  const state = createSignal<PlaygroundState>({
    name: 'Fastium Playground',
    framework: 'fastium',
    activeFile: initialFiles[0]?.path ?? 'main.fst',
    files: initialFiles,
    console: [],
    diagnostics: []
  });
  const sessionId = randomId('playground');

  const patchState = (updater: (current: PlaygroundState) => PlaygroundState) => {
    state.update(updater);
  };

  return {
    sessionId,
    state,
    openFile(path: string) {
      patchState(current => ({ ...current, activeFile: path }));
    },
    updateFile(path: string, content: string) {
      patchState(current => ({
        ...current,
        files: current.files.map(file => file.path === path ? { ...file, content } : file)
      }));
    },
    addFile(file: PlaygroundFile) {
      patchState(current => ({
        ...current,
        files: [...current.files, file]
      }));
    },
    removeFile(path: string) {
      patchState(current => ({
        ...current,
        files: current.files.filter(file => file.path !== path)
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
        diagnostics: [...current.diagnostics, message].slice(-100)
      }));
    },
    snapshot(): PlaygroundState {
      return state.get();
    },
    renderHtml() {
      return createShellHtml(state.get());
    }
  };
};