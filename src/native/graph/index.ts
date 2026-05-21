export { ModuleGraph, createGraph } from '../../graph/index.js';

export interface NativeGraphInput {
  id: string;
  imports: string[];
}

export interface NativeInvalidationResult {
  affected: string[];
  durationMs: number;
}

export const invalidateGraphNative = (modules: NativeGraphInput[], changedId: string): NativeInvalidationResult => {
  const startedAt = performance.now();
  const importedBy = new Map<string, string[]>();

  for (const module of modules) {
    for (const dependency of module.imports) {
      const parents = importedBy.get(dependency);
      if (parents) {
        parents.push(module.id);
      } else {
        importedBy.set(dependency, [module.id]);
      }
    }
  }

  const affected: string[] = [];
  const seen = new Set<string>();
  const stack = [changedId];

  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    affected.push(id);
    const parents = importedBy.get(id) ?? [];
    for (const parent of parents) {
      stack.push(parent);
    }
  }

  return {
    affected,
    durationMs: performance.now() - startedAt
  };
};

export const detectGraphCyclesNative = (modules: NativeGraphInput[]): string[][] => {
  const byId = new Map(modules.map(module => [module.id, module]));
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string) => {
    if (visiting.has(id)) {
      const index = stack.indexOf(id);
      if (index >= 0) {
        cycles.push([...stack.slice(index), id]);
      }
      return;
    }

    if (visited.has(id)) {
      return;
    }

    const module = byId.get(id);
    if (!module) {
      return;
    }

    visiting.add(id);
    stack.push(id);
    for (const dependency of module.imports) {
      visit(dependency);
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
  };

  for (const module of modules) {
    visit(module.id);
  }

  return cycles;
};
