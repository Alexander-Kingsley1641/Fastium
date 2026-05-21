export interface CompilerTransformContext {
  filePath?: string;
  framework?: 'fastium' | 'react' | 'vue';
}

export type CompilerTransform = (source: string, context: CompilerTransformContext) => string | Promise<string>;

export const applyCompilerTransforms = async (source: string, context: CompilerTransformContext, transforms: CompilerTransform[] = []): Promise<string> => {
  let output = source;
  for (const transform of transforms) {
    output = await transform(output, context);
  }

  return output;
};