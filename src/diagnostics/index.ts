export interface StackFrame {
  filePath: string;
  line: number;
  column: number;
  functionName?: string;
}

export interface DiagnosticReport {
  message: string;
  stack?: string;
  frames: StackFrame[];
  codeFrame?: string;
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const parseStackTrace = (stack?: string): StackFrame[] => {
  if (!stack) {
    return [];
  }

  const frames: StackFrame[] = [];
  const pattern = /(?:at\s+)?(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?/;

  for (const line of stack.split('\n')) {
    const match = line.match(pattern);
    if (!match) {
      continue;
    }

    frames.push({
      functionName: match[1] ? match[1].trim() : undefined,
      filePath: match[2],
      line: Number(match[3]),
      column: Number(match[4])
    });
  }

  return frames;
};

export const createCodeFrame = (source: string, lineNumber: number, columnNumber: number, contextLines = 2): string => {
  const lines = source.split('\n');
  const start = Math.max(1, lineNumber - contextLines);
  const end = Math.min(lines.length, lineNumber + contextLines);
  const width = String(end).length;

  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const currentLine = start + offset;
    const prefix = String(currentLine).padStart(width, ' ');
    const marker = currentLine === lineNumber ? '>' : ' ';
    const content = lines[currentLine - 1] ?? '';
    if (currentLine === lineNumber) {
      const indicator = `${' '.repeat(Math.max(columnNumber - 1, 0))}^`;
      return `${marker} ${prefix} | ${content}\n  ${' '.repeat(width)} | ${indicator}`;
    }

    return `${marker} ${prefix} | ${content}`;
  }).join('\n');
};

export const createDiagnosticReport = (error: Error, source?: string): DiagnosticReport => {
  const frames = parseStackTrace(error.stack);
  const frame = frames[0];
  return {
    message: error.message,
    stack: error.stack,
    frames,
    codeFrame: frame && source ? createCodeFrame(source, frame.line, frame.column) : undefined
  };
};

export const renderErrorOverlay = (report: DiagnosticReport): string => {
  const codeFrame = report.codeFrame ? `<pre class="fastium-codeframe">${escapeHtml(report.codeFrame)}</pre>` : '';
  const frames = report.frames
    .map(frame => `<li>${escapeHtml(frame.functionName ?? 'anonymous')} ${escapeHtml(frame.filePath)}:${frame.line}:${frame.column}</li>`)
    .join('');

  return `
    <div class="fastium-overlay">
      <style>
        .fastium-overlay { position: fixed; inset: 0; z-index: 2147483647; background: rgba(11, 13, 18, 0.96); color: #f8fafc; font-family: ui-sans-serif, system-ui, sans-serif; padding: 24px; overflow: auto; }
        .fastium-overlay h1 { margin: 0 0 12px; font-size: 22px; }
        .fastium-overlay h2 { margin: 24px 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.12em; color: #94a3b8; }
        .fastium-codeframe { background: rgba(15, 23, 42, 0.92); color: #e2e8f0; padding: 16px; border-radius: 14px; border: 1px solid rgba(148, 163, 184, 0.15); overflow: auto; }
        .fastium-overlay ul { margin: 0; padding-left: 18px; }
        .fastium-overlay button { background: #38bdf8; color: #08111f; border: 0; padding: 10px 14px; border-radius: 999px; font-weight: 700; cursor: pointer; }
      </style>
      <h1>Fastium runtime error</h1>
      <p>${escapeHtml(report.message)}</p>
      ${codeFrame}
      <h2>Stack</h2>
      <ul>${frames}</ul>
      <button data-fastium-action="reload">Reload</button>
    </div>
  `;
};