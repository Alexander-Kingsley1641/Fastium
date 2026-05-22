import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCache, isTransformCacheRecordFresh, readFileMetadata, type FileCacheMetadata, type MemoryCache, type TransformCacheRecord } from '../cache/index.js';
import { createCompiler, type CompilationResult } from '../compiler/index.js';
import { createLogger, type Logger } from '../logger/index.js';
import { createGraph } from '../graph/index.js';
import { scanImportSpecifiersNative } from '../native/parser/index.js';
import { normalizeModuleId, toPublicModuleId } from '../utils/module-id.js';

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
  const moduleGraph = createGraph(rootDir);
  const persistentCacheDir = path.join(rootDir, '.cache', 'fastium');

  const saveGraphSnapshot = async (): Promise<void> => {
    try {
      await mkdir(persistentCacheDir, { recursive: true });
      await writeFile(path.join(persistentCacheDir, 'graph.json'), `${moduleGraph.serialize()}\n`, 'utf8');
      await writeFile(path.join(persistentCacheDir, 'cache-stats.json'), `${JSON.stringify(cache.stats(), null, 2)}\n`, 'utf8');
    } catch (error) {
      logger.debug('persistent cache write failed', error);
    }
  };

  const compileWithCache = async (absolutePath: string): Promise<CompilationResult> => {
    const moduleId = normalizeModuleId(rootDir, absolutePath);
    const cached = cache.get(moduleId);
    if (await isTransformCacheRecordFresh(cached)) {
      return cached?.value as CompilationResult;
    }

    const source = await readFile(moduleId, 'utf8');
    const compilation = await compiler.compileSource(source, { filePath: moduleId });
    const metadata = await readFileMetadata(moduleId, compilation.hash);
    const dependencies = extractDependencies(compilation.code);
    const dependencyMetadata: Record<string, FileCacheMetadata> = {};

    for (const dependency of dependencies) {
      if (!isRelativeSpecifier(dependency)) {
        continue;
      }

      const resolved = await resolveCandidate(path.resolve(path.dirname(moduleId), dependency)) ?? await resolveCandidate(path.join(path.resolve(path.dirname(moduleId), dependency), 'index'));
      if (resolved) {
        const metadataForDependency = await readFileMetadata(resolved);
        if (metadataForDependency) {
          dependencyMetadata[resolved] = metadataForDependency;
        }
      }
    }

    if (metadata) {
      cache.set(moduleId, {
        value: compilation,
        metadata,
        dependencies: dependencyMetadata
      });
    }

    return compilation;
  };

  const graph = async (entryFilePath: string, visited = new Map<string, BundleModule>(), externals = new Set<string>()): Promise<{ visited: Map<string, BundleModule>; externals: Set<string> }> => {
    const absoluteEntry = path.isAbsolute(entryFilePath) ? entryFilePath : path.resolve(rootDir, entryFilePath);
    const moduleId = normalizeModuleId(rootDir, absoluteEntry);
    if (visited.has(moduleId)) {
      return { visited, externals };
    }
    const compilation = await compileWithCache(moduleId);
    const dependencies = extractDependencies(compilation.code);
    const resolvedDependencies: string[] = [];
    visited.set(moduleId, {
      id: moduleId,
      filePath: moduleId,
      dependencies,
      compilation
    });

    // update module graph
    try {
      moduleGraph.addModule(moduleId);
    } catch {}

    for (const dependency of dependencies) {
      if (!isRelativeSpecifier(dependency)) {
        externals.add(dependency);
        continue;
      }

      const basePath = path.resolve(path.dirname(moduleId), dependency);
      const resolved = await resolveCandidate(basePath) ?? await resolveCandidate(path.join(basePath, 'index'));
      if (!resolved) {
        externals.add(dependency);
        continue;
      }

      resolvedDependencies.push(resolved);

      await graph(resolved, visited, externals);
    }

    try {
      moduleGraph.setDependencies(moduleId, resolvedDependencies);
      moduleGraph.updateModule(moduleId, {
        hash: compilation.hash,
        lastUpdated: Date.now(),
        transformResult: compilation,
        cache: cache.get(moduleId),
        acceptedHMR: compilation.code.includes('__FASTIUM_HMR__') || compilation.code.includes('import.meta.hot'),
        selfAccepting: compilation.code.includes('import.meta.hot.accept'),
        hmrBoundaries: { accepts: compilation.code.includes('__FASTIUM_HMR__') || compilation.code.includes('import.meta.hot'), framework: compilation.framework }
      });
    } catch {}

    return { visited, externals };
  };

  const bundle = async (entryFilePath: string): Promise<BundleResult> => {
    const { visited, externals } = await graph(entryFilePath);
    const modules = Array.from(visited.values());
    const code = modules
      .map(module => `// ${toPublicModuleId(rootDir, module.filePath)}\n${module.compilation.code}`)
      .join('\n\n');

    logger.info('bundle ready', entryFilePath, modules.length, 'modules');
    await saveGraphSnapshot();
    return {
      entry: entryFilePath,
      modules,
      externals: Array.from(externals),
      code
    };
  };

  const rebuildOne = async (absolute: string) => {
    const moduleId = normalizeModuleId(rootDir, absolute);
    const prev = cache.get(moduleId)?.value;
    cache.delete(moduleId);
    const compilation = await compileWithCache(moduleId);
    try {
      moduleGraph.updateModule(moduleId, {
        hash: compilation.hash,
        lastUpdated: Date.now(),
        transformResult: compilation,
        cache: cache.get(moduleId),
        acceptedHMR: compilation.code.includes('__FASTIUM_HMR__') || compilation.code.includes('import.meta.hot'),
        selfAccepting: compilation.code.includes('import.meta.hot.accept')
      });
    } catch {}

    const packet = {
      type: 'update',
      moduleId,
      payload: {
        code: compilation.code,
        hash: compilation.hash,
        prevHash: prev?.hash,
          filePath: moduleId
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
        const abs = normalizeModuleId(rootDir, filePath);
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
      return [await rebuildOne(normalizeModuleId(rootDir, absolute))];
    },
    rebuildAffected: async (filePath: string) => {
      const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(rootDir, filePath);
      const plan = moduleGraph.resolveHotUpdate(absolute);
      const targets = plan.affected.length > 0 ? plan.affected : [normalizeModuleId(rootDir, absolute)];
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
      cache: cache.stats(),
      snapshot: moduleGraph.snapshot()
    })
  };
};
