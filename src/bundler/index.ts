import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createCache, type MemoryCache } from '../cache/index.js';
import { createCompiler, type CompilationResult } from '../compiler/index.js';
import { createLogger, type Logger } from '../logger/index.js';

export interface BundleModule {
  id: string;
  filePath: string;
  dependencies: string[];
  compilation: CompilationResult;
}

export interface BundleResult {
  entry: string;
  modules: BundleModule[];
  externals: string[];
  code: string;
}

export interface BundlerOptions {
  rootDir?: string;
  logger?: Logger;
  compiler?: ReturnType<typeof createCompiler>;
  cache?: MemoryCache<string, CompilationResult>;
}

const IMPORT_PATTERN = /(?:import|export)\s+(?:[^'"`]*?\s+from\s+)?['"`]([^'"`]+)['"`]/g;
const DYNAMIC_IMPORT_PATTERN = /import\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
const EXTENSIONS = ['.fst', '.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx'];

const isRelativeSpecifier = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/');

const resolveCandidate = async (basePath: string): Promise<string | undefined> => {
  try {
    const fileStat = await stat(basePath);
    if (fileStat.isFile()) {
      return basePath;
    }
  } catch {
    // ignore missing exact path
  }

  for (const extension of EXTENSIONS) {
    try {
      await readFile(`${basePath}${extension}`, 'utf8');
      return `${basePath}${extension}`;
    } catch {
      continue;
    }
  }

  try {
    const indexPath = path.join(basePath, 'index.ts');
    await readFile(indexPath, 'utf8');
    return indexPath;
  } catch {
    return undefined;
  }
};

const extractDependencies = (source: string): string[] => {
  const dependencies = new Set<string>();
  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      dependencies.add(specifier);
    }
  }

  for (const match of source.matchAll(DYNAMIC_IMPORT_PATTERN)) {
    const specifier = match[1];
    if (specifier) {
      dependencies.add(specifier);
    }
  }

  return Array.from(dependencies);
};

export const createBundler = (options: BundlerOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const logger = options.logger ?? createLogger({ scope: 'fastium:bundler', debug: false });
  const compiler = options.compiler ?? createCompiler({ logger: logger.child('compiler') });
  const cache = options.cache ?? createCache<string, CompilationResult>({ maxEntries: 256 });

  const graph = async (entryFilePath: string, visited = new Map<string, BundleModule>(), externals = new Set<string>()): Promise<{ visited: Map<string, BundleModule>; externals: Set<string> }> => {
    const absoluteEntry = path.isAbsolute(entryFilePath) ? entryFilePath : path.resolve(rootDir, entryFilePath);
    if (visited.has(absoluteEntry)) {
      return { visited, externals };
    }

    const compilation = cache.get(absoluteEntry) ?? await compiler.compileFile(absoluteEntry);
    cache.set(absoluteEntry, compilation);
    const dependencies = extractDependencies(compilation.code);
    visited.set(absoluteEntry, {
      id: path.relative(rootDir, absoluteEntry) || path.basename(absoluteEntry),
      filePath: absoluteEntry,
      dependencies,
      compilation
    });

    for (const dependency of dependencies) {
      if (!isRelativeSpecifier(dependency)) {
        externals.add(dependency);
        continue;
      }

      const basePath = path.resolve(path.dirname(absoluteEntry), dependency);
      const resolved = await resolveCandidate(basePath) ?? await resolveCandidate(path.join(basePath, 'index'));
      if (!resolved) {
        externals.add(dependency);
        continue;
      }

      await graph(resolved, visited, externals);
    }

    return { visited, externals };
  };

  const bundle = async (entryFilePath: string): Promise<BundleResult> => {
    const { visited, externals } = await graph(entryFilePath);
    const modules = Array.from(visited.values());
    const code = modules
      .map(module => `// ${path.relative(rootDir, module.filePath)}\n${module.compilation.code}`)
      .join('\n\n');

    logger.info('bundle ready', entryFilePath, modules.length, 'modules');
    return {
      entry: entryFilePath,
      modules,
      externals: Array.from(externals),
      code
    };
  };

  return {
    bundle,
    graph,
    resolve: async (specifier: string, from = rootDir): Promise<string | undefined> => {
      if (!isRelativeSpecifier(specifier)) {
        return undefined;
      }

      const basePath = path.resolve(from, specifier);
      return resolveCandidate(basePath) ?? resolveCandidate(path.join(basePath, 'index'));
    }
  };
};