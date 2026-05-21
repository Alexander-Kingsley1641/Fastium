import { deepMerge } from '@alexium/utils';

export interface TranspileOptions {
  readonly filename?: string;
  readonly jsx?: boolean;
  readonly sourcemap?: boolean;
  readonly target?: 'browser' | 'node';
}

export interface TranspileResult {
  readonly code: string;
  readonly map?: string;
  readonly diagnostics: readonly string[];
}

const stripTypeOnlyImports = (source: string) => source.replace(/^import\s+type\s+[^;]+;$/gm, '');
const stripInterfaces = (source: string) => source.replace(/^export\s+interface\s+[^{]+\{[\s\S]*?\n\}/gm, '');

export const scanDependencies = (source: string) => {
  const matches = new Set<string>();
  const pattern = /(?:import|export)\s+(?:[^'"`]*?from\s+)?['"`]([^'"`]+)['"`]/g;
  let result: RegExpExecArray | null;

  while ((result = pattern.exec(source))) {
    const specifier = result[1];
    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      matches.add(specifier);
    }
  }

  return [...matches];
};

export const transpileSource = (source: string, options: TranspileOptions = {}): TranspileResult => {
  const normalized = deepMerge({ target: 'browser', jsx: false, sourcemap: false }, options as Record<string, unknown>) as Required<TranspileOptions>;
  const diagnostics: string[] = [];
  let code = stripTypeOnlyImports(source);
  code = stripInterfaces(code);

  if (normalized.jsx) {
    code = code.replace(/<([A-Z][A-Za-z0-9]*)\s*\/\>/g, 'h($1)');
  }

  if (!code.includes('export default') && code.includes('module.exports')) {
    diagnostics.push('CommonJS patterns detected and preserved for compatibility');
  }

  return {
    code,
    diagnostics,
    map: normalized.sourcemap ? JSON.stringify({ version: 3, mappings: '' }) : undefined
  };
};

export const transformModule = (source: string, options: TranspileOptions = {}) => transpileSource(source, options).code;
export const createTranspiler = () => ({ scanDependencies, transpileSource, transformModule });
