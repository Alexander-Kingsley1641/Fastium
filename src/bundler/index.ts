import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { createCache, isTransformCacheRecordFresh, readFileMetadata, type FileCacheMetadata, type MemoryCache, type TransformCacheRecord } from '../cache/index.js';
import { createCompiler, type CompilationResult } from '../compiler/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { createGraph } from '../graph/index.js';
import { scanImportSpecifiersNative } from '../native/parser/index.js';

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
  cache?: MemoryCache<string, TransformCacheRecord<CompilationResult>>;
}

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
  return scanImportSpecifiersNative(source);
};

export const createBundler = (options: BundlerOptions = {}) => {
  const rootDir = options.rootDir ?? process.cwd();
  const logger = options.logger ?? createLogger({ scope: 'fastium:bundler', debug: false });
  const compiler = options.compiler ?? createCompiler({ logger: logger.child('compiler') });
  const cache = options.cache ?? createCache<string, TransformCacheRecord<CompilationResult>>({ maxEntries: 256 });
  const moduleGraph = createGraph();

  const compileWithCache = async (absolutePath: string): Promise<CompilationResult> => {
    const cached = cache.get(absolutePath);
    if (await isTransformCacheRecordFresh(cached)) {
      return cached?.value as CompilationResult;
    }

    const source = await readFile(absolutePath, 'utf8');
    const compilation = await compiler.compileSource(source, { filePath: absolutePath });
    const metadata = await readFileMetadata(absolutePath, compilation.hash);
    const dependencies = extractDependencies(compilation.code);
    const dependencyMetadata: Record<string, FileCacheMetadata> = {};

    for (const dependency of dependencies) {
      if (!isRelativeSpecifier(dependency)) {
        continue;
      }

      const resolved = await resolveCandidate(path.resolve(path.dirname(absolutePath), dependency)) ?? await resolveCandidate(path.join(path.resolve(path.dirname(absolutePath), dependency), 'index'));
      if (resolved) {
        const metadataForDependency = await readFileMetadata(resolved);
        if (metadataForDependency) {
          dependencyMetadata[resolved] = metadataForDependency;
        }
      }
    }

    if (metadata) {
      cache.set(absolutePath, {
        value: compilation,
        metadata,
        dependencies: dependencyMetadata
      });
    }

    return compilation;
  };

  const graph = async (entryFilePath: string, visited = new Map<string, BundleModule>(), externals = new Set<string>()): Promise<{ visited: Map<string, BundleModule>; externals: Set<string> }> => {
    const absoluteEntry = path.isAbsolute(entryFilePath) ? entryFilePath : path.resolve(rootDir, entryFilePath);
    if (visited.has(absoluteEntry)) {
      return { visited, externals };
    }
    const compilation = await compileWithCache(absoluteEntry);
    const dependencies = extractDependencies(compilation.code);
    const resolvedDependencies: string[] = [];
    visited.set(absoluteEntry, {
      id: path.relative(rootDir, absoluteEntry) || path.basename(absoluteEntry),
      filePath: absoluteEntry,
      dependencies,
      compilation
    });

    // update module graph
    try {
      moduleGraph.addModule(absoluteEntry);
    } catch {}

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

      resolvedDependencies.push(resolved);

      await graph(resolved, visited, externals);
    }

    try {
      moduleGraph.setDependencies(absoluteEntry, resolvedDependencies);
      moduleGraph.updateModule(absoluteEntry, {
        hash: compilation.hash,
        lastUpdate: Date.now(),
        transformResult: compilation,
        cache: cache.get(absoluteEntry),
        hmrBoundaries: {
          accepts: compilation.code.includes('__FASTIUM_HMR__') || compilation.code.includes('import.meta.hot'),
          framework: compilation.framework
        }
      });
    } catch {}

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

  const rebuildOne = async (absolute: string) => {
    const prev = cache.get(absolute)?.value;
    cache.delete(absolute);
    const compilation = await compileWithCache(absolute);
    try {
      moduleGraph.updateModule(absolute, {
        hash: compilation.hash,
        lastUpdate: Date.now(),
        transformResult: compilation,
        cache: cache.get(absolute)
      });
    } catch {}

    const moduleId = (path.relative(rootDir, absolute) || path.basename(absolute)).replace(/\\/g, '/');
    const packet = {
      type: 'update',
      moduleId,
      payload: {
        code: compilation.code,
        hash: compilation.hash,
        prevHash: prev?.hash,
        filePath: absolute
      },
      timestamp: Date.now()
    } as const;

    logger.debug('rebuildModule', moduleId, prev?.hash ? `${prev.hash.slice(0, 8)}->${compilation.hash.slice(0, 8)}` : compilation.hash.slice(0, 8));
    return packet;
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
    ,
    invalidate: (filePath: string) => {
      const affected = (() => {
        try {
          return moduleGraph.invalidate(filePath);
        } catch {
          return [];
        }
      })();
      try {
        const abs = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
        const targets = affected.length > 0 ? affected : [abs];
        for (const target of targets) {
          if (typeof (cache as any).invalidate === 'function') {
            (cache as any).invalidate(target);
          } else {
            cache.delete(target);
          }
        }
      } catch {}
      return affected;
    }
    ,
    rebuildModule: async (filePath: string) => {
      const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
      return [await rebuildOne(absolute)];
    },
    rebuildAffected: async (filePath: string) => {
      const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
      const affected = moduleGraph.invalidate(absolute);
      const targets = affected.length > 0 ? affected : [absolute];
      const packets: Array<Awaited<ReturnType<typeof rebuildOne>>> = [];
      for (const target of targets) {
        if (await resolveCandidate(target)) {
          try {
            packets.push(await rebuildOne(target));
          } catch {
            continue;
          }
        }
      }

      return packets;
    },
    moduleGraph,
    cacheStats: () => cache.stats(),
    analyzeGraph: () => ({
      modules: moduleGraph.entries().length,
      cycles: moduleGraph.detectCycles(),
      cache: cache.stats()
    })
  };
};
