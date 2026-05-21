import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PluginDefinition } from '@alexium/types';
import { createPluginContainer } from '@alexium/plugins';
import { scanDependencies, transpileSource, type TranspileOptions } from '@alexium/transpiler';

export interface ModuleGraphNode {
  readonly id: string;
  readonly dependencies: readonly string[];
  readonly code: string;
}

export interface CompilerOptions {
  readonly root?: string;
  readonly plugins?: readonly PluginDefinition[];
  readonly transpile?: TranspileOptions;
}

export interface CompileResult {
  readonly entry: string;
  readonly graph: readonly ModuleGraphNode[];
  readonly output: string;
}

const readModule = async (entry: string, root = process.cwd()) => {
  const resolved = path.isAbsolute(entry) ? entry : path.join(root, entry);
  const source = await readFile(resolved, 'utf8');
  return { id: resolved, source };
};

export const createCompiler = (options: CompilerOptions = {}) => {
  const plugins = createPluginContainer(options.plugins ?? []);
  const graph = new Map<string, ModuleGraphNode>();

  const buildModule = async (entry: string, root = options.root ?? process.cwd()): Promise<ModuleGraphNode> => {
    const cached = graph.get(entry);
    if (cached) {
      return cached;
    }

    const module = await readModule(entry, root);
    const transformed = await plugins.transform(transpileSource(module.source, options.transpile).code, module.id);
    const dependencies = scanDependencies(transformed);
    const node: ModuleGraphNode = { id: module.id, dependencies, code: transformed };
    graph.set(module.id, node);

    for (const dependency of dependencies) {
      if (dependency.startsWith('.')) {
        const childPath = path.resolve(path.dirname(module.id), dependency);
        await buildModule(childPath.endsWith('.ts') || childPath.endsWith('.js') ? childPath : `${childPath}.ts`, root);
      }
    }

    return node;
  };

  return {
    async compile(entry: string): Promise<CompileResult> {
      const root = options.root ?? process.cwd();
      const entryNode = await buildModule(entry, root);
      const orderedGraph = [...graph.values()];
      const output = orderedGraph.map(node => `// ${path.basename(node.id)}\n${node.code}`).join('\n\n');
      return { entry: entryNode.id, graph: orderedGraph, output };
    },
    graph,
    clear() {
      graph.clear();
    }
  };
};

export const compileEntry = async (entry: string, options: CompilerOptions = {}) => createCompiler(options).compile(entry);
