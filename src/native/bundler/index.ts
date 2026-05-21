import path from 'node:path';

import { scanImportSpecifiersNative } from '../parser/index.js';
import { fastHash32 } from '../hashing/index.js';
import { detectGraphCyclesNative, invalidateGraphNative, type NativeGraphInput } from '../graph/index.js';

export interface NativeBundleModule {
  id: string;
  source: string;
}

export interface NativeChunkGraph {
  modules: NativeGraphInput[];
  chunks: Array<{ id: string; modules: string[]; hash: string }>;
  cycles: string[][];
}

const isRelative = (specifier: string): boolean => specifier.startsWith('.') || specifier.startsWith('/');

const resolveVirtual = (from: string, specifier: string, ids: Set<string>): string => {
  const base = path.normalize(path.join(path.dirname(from), specifier)).replace(/\\/g, '/');
  if (ids.has(base)) return base;
  if (ids.has(`${base}.ts`)) return `${base}.ts`;
  if (ids.has(`${base}.fst`)) return `${base}.fst`;
  if (ids.has(`${base}.js`)) return `${base}.js`;
  return base;
};

export const createChunkGraphNative = (modules: NativeBundleModule[]): NativeChunkGraph => {
  const ids = new Set(modules.map(module => module.id));
  const graph = modules.map(module => ({
    id: module.id,
    imports: scanImportSpecifiersNative(module.source)
      .filter(isRelative)
      .map(specifier => resolveVirtual(module.id, specifier, ids))
  }));

  return {
    modules: graph,
    chunks: graph.map(module => ({
      id: module.id,
      modules: [module.id, ...module.imports],
      hash: fastHash32(`${module.id}:${module.imports.join(',')}`)
    })),
    cycles: detectGraphCyclesNative(graph)
  };
};

export const invalidateChunkGraphNative = (graph: NativeChunkGraph, changedId: string) => invalidateGraphNative(graph.modules, changedId);
