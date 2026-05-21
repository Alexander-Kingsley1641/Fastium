import { optimizeFastSource } from '../../compiler/optimizer.js';
import { scanImportSpecifiersNative } from '../parser/index.js';
import { fastHash32, fnv1a32 } from '../hashing/index.js';

export interface NativeCompilerAnalysis {
  imports: string[];
  sourceHash: string;
  optimizedHash: string;
  sourceBytes: number;
  optimizedBytes: number;
}

const encoder = new TextEncoder();

export const analyzeCompilationNative = (source: string): NativeCompilerAnalysis => {
  const sourceBytes = encoder.encode(source);
  const optimized = optimizeFastSource(source);
  const optimizedBytes = encoder.encode(optimized);

  return {
    imports: scanImportSpecifiersNative(sourceBytes),
    sourceHash: fastHash32(sourceBytes),
    optimizedHash: fastHash32(optimizedBytes),
    sourceBytes: sourceBytes.byteLength,
    optimizedBytes: optimizedBytes.byteLength
  };
};

export const diffRuntimePatchNative = (previous: string, next: string): Uint32Array => {
  const previousBytes = encoder.encode(previous);
  const nextBytes = encoder.encode(next);
  const max = Math.max(previousBytes.byteLength, nextBytes.byteLength);
  const ranges: number[] = [];
  let start = -1;

  for (let index = 0; index < max; index += 1) {
    if (previousBytes[index] !== nextBytes[index]) {
      if (start === -1) start = index;
    } else if (start !== -1) {
      ranges.push(start, index - start, fnv1a32(nextBytes.subarray(start, index)));
      start = -1;
    }
  }

  if (start !== -1) {
    ranges.push(start, max - start, fnv1a32(nextBytes.subarray(start)));
  }

  return Uint32Array.from(ranges);
};

export const estimateTransformCostNative = (source: string): number => {
  const imports = scanImportSpecifiersNative(source).length;
  return source.length + imports * 128;
};
