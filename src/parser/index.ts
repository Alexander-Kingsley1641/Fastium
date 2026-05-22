import { lex, type FastToken } from '../lexer/index.js';
import { scanImportsNative } from '../native/parser/index.js';

export interface FastDeclaration {
  kind: string;
  name?: string;
  start: number;
  end: number;
}

export interface FastProgram {
  type: 'Program';
  source: string;
  tokens: FastToken[];
  declarations: FastDeclaration[];
  imports: string[];
  exports: string[];
  framework: 'fastium' | 'react' | 'vue';
  diagnostics: Array<{ message: string; line: number; column: number }>;
}

export interface ImportRecord {
  specifier: string;
  start: number;
  end: number;
  dynamic: boolean;
}

export interface ExportRecord {
  name: string;
  kind: string;
  start: number;
  end: number;
}

export interface ParsedModule {
  id: string;
  code: string;
  imports: ImportRecord[];
  exports: ExportRecord[];
  ast?: FastProgram;
  diagnostics: FastProgram['diagnostics'];
}

const collectModuleSpecifiers = (source: string): { imports: string[]; exports: string[] } => {
  const imports = new Set<string>();
  const exports = new Set<string>();

  const importPattern = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
  const dynamicPattern = /import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;

  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1];
    if (specifier) {
      imports.add(specifier);
    }
  }

  for (const match of source.matchAll(dynamicPattern)) {
    const specifier = match[1];
    if (specifier) {
      imports.add(specifier);
    }
  }

  const exportPattern = /export\s+(?:default\s+)?(?:const|let|var|function|class)?\s*([A-Za-z_$][A-Za-z0-9_$]*)?/g;
  for (const match of source.matchAll(exportPattern)) {
    const name = match[1];
    if (name) {
      exports.add(name);
    }
  }

  return { imports: Array.from(imports), exports: Array.from(exports) };
};

const detectFramework = (source: string): 'fastium' | 'react' | 'vue' => {
  const normalized = source.toLowerCase();
  if (normalized.includes("from 'react'") || normalized.includes('from "react"')) {
    return 'react';
  }

  if (normalized.includes('.vue') || normalized.includes('<template>')) {
    return 'vue';
  }

  return 'fastium';
};

export const parseFastSource = (source: string): FastProgram => {
  const tokens = lex(source);
  const declarations: FastDeclaration[] = [];

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token.type === 'keyword' && ['import', 'export', 'function', 'class', 'const', 'let', 'var', 'interface', 'type', 'enum'].includes(token.value)) {
      const next = tokens[index + 1];
      declarations.push({
        kind: token.value,
        name: next?.type === 'identifier' ? next.value : undefined,
        start: token.start,
        end: next?.end ?? token.end
      });
    }
  }

  const moduleSpecifiers = collectModuleSpecifiers(source);

  return {
    type: 'Program',
    source,
    tokens,
    declarations,
    imports: moduleSpecifiers.imports,
    exports: moduleSpecifiers.exports,
    framework: detectFramework(source),
    diagnostics: []
  };
};

export const parseModule = (code: string, id = '<memory>'): ParsedModule => {
  const ast = parseFastSource(code);
  const imports = scanImportsNative(code).map(record => ({
    specifier: record.specifier,
    start: record.start,
    end: record.end,
    dynamic: record.dynamic
  }));
  const exports = ast.exports.map(name => {
    const declaration = ast.declarations.find(item => item.name === name);
    return {
      name,
      kind: declaration?.kind ?? 'export',
      start: declaration?.start ?? 0,
      end: declaration?.end ?? 0
    };
  });

  return {
    id,
    code,
    imports,
    exports,
    ast,
    diagnostics: ast.diagnostics
  };
};
