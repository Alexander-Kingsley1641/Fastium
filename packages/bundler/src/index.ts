import path from 'node:path';
import { createCompiler, type CompilerOptions } from '@alexium/compiler';

export interface BundleOptions extends CompilerOptions {
  readonly format?: 'esm' | 'cjs';
  readonly minify?: boolean;
}

export interface BundleResult {
  readonly entry: string;
  readonly code: string;
  readonly format: 'esm' | 'cjs';
  readonly modules: readonly { id: string; dependencies: readonly string[] }[];
}

export const createBundler = (options: BundleOptions = {}) => {
  const compiler = createCompiler(options);

  return {
    async bundle(entry: string): Promise<BundleResult> {
      const result = await compiler.compile(entry);
      const code = options.minify
        ? result.output.replace(/\n+/g, '\n').replace(/\s{2,}/g, ' ')
        : result.output;

      return {
        entry: result.entry,
        code,
        format: options.format ?? 'esm',
        modules: result.graph.map(node => ({ id: node.id, dependencies: node.dependencies }))
      };
    },
    async writeManifest(entry: string) {
      const result = await compiler.compile(entry);
      return {
        entry: result.entry,
        files: result.graph.map(node => path.basename(node.id))
      };
    }
  };
};

export const bundleEntry = async (entry: string, options: BundleOptions = {}) => createBundler(options).bundle(entry);
export type { PluginDefinition } from '@alexium/types';

