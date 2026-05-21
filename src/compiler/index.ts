import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { createLogger, type Logger } from '../logger/index.js';
import { parseFastSource, type FastProgram } from '../parser/index.js';
import { optimizeFastSource } from './optimizer.js';
import { applyCompilerTransforms, type CompilerTransform, type CompilerTransformContext } from './transforms.js';
import { createHmrTransform } from './hmr-transform.js';

export interface CompilationResult {
  code: string;
  ast: FastProgram;
  framework: 'fastium' | 'react' | 'vue';
  hash: string;
  filePath?: string;
  diagnostics: FastProgram['diagnostics'];
}

export interface CompilerOptions {
  logger?: Logger;
  transforms?: CompilerTransform[];
}

const hashSource = (source: string): string => createHash('sha256').update(source).digest('hex');

export const createCompiler = (options: CompilerOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:compiler', debug: false });

  const compileSource = async (source: string, context: CompilerTransformContext = {}): Promise<CompilationResult> => {
    const ast = parseFastSource(source);
    const transforms: CompilerTransform[] = [createHmrTransform(), ...(options.transforms ?? [])];
    const transformed = await applyCompilerTransforms(source, { filePath: context.filePath, framework: ast.framework }, transforms);
    const code = optimizeFastSource(transformed);
    const result: CompilationResult = {
      code,
      ast,
      framework: context.framework ?? ast.framework,
      hash: hashSource(code),
      filePath: context.filePath,
      diagnostics: ast.diagnostics
    };

    logger.debug('compiled', context.filePath ?? '<memory>', result.hash);
    return result;
  };

  const compileFile = async (filePath: string): Promise<CompilationResult> => {
    const source = await readFile(filePath, 'utf8');
    return compileSource(source, { filePath });
  };

  return {
    compileSource,
    compileFile,
    compileProgram: async (program: FastProgram): Promise<CompilationResult> => compileSource(program.source, { framework: program.framework }),
    logger
  };
};

export const compileFastSource = async (source: string, context: CompilerTransformContext = {}): Promise<CompilationResult> => createCompiler().compileSource(source, context);