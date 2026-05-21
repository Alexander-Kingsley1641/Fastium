import { analyzeCompilationNative, diffRuntimePatchNative } from '../compiler/index.js';
import { createChunkGraphNative, invalidateChunkGraphNative } from '../bundler/index.js';
import { fnv1a32 } from '../hashing/index.js';
import { createNativeHmrBatch } from '../hmr/index.js';
import { createByteArena, ObjectPool } from '../memory/index.js';
import { scanImportSpecifiersNative } from '../parser/index.js';
import { encodeRuntimePacketNative, decodeRuntimePacketNative } from '../websocket/index.js';

export interface NativeBenchmarkResult {
  name: string;
  durationMs: number;
  targetMs: number;
  status: 'pass' | 'warn' | 'fail';
  retainedHeap: number;
}

export interface NativeBenchmarkReport {
  generatedAt: string;
  totalMs: number;
  results: NativeBenchmarkResult[];
  memory: {
    heapUsed: number;
    arenaBytes: number;
  };
}

const TARGET_MS = 10;

const statusFor = (durationMs: number): NativeBenchmarkResult['status'] => durationMs <= TARGET_MS ? 'pass' : durationMs <= TARGET_MS * 3 ? 'warn' : 'fail';

export const runNativeBenchmark = async (name: string, run: () => unknown | Promise<unknown>): Promise<NativeBenchmarkResult> => {
  const before = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  await run();
  const durationMs = performance.now() - startedAt;
  const after = process.memoryUsage().heapUsed;

  return {
    name,
    durationMs: Number(durationMs.toFixed(3)),
    targetMs: TARGET_MS,
    status: statusFor(durationMs),
    retainedHeap: after - before
  };
};

export const runNativeBenchmarkSuite = async (source = "import { createApp } from 'fastium';\nimport value from './dep';\nexport default createApp();\n"): Promise<NativeBenchmarkReport> => {
  const arena = createByteArena(64 * 1024);
  const graph = createChunkGraphNative([
    { id: 'src/main.fst', source },
    { id: 'src/dep.ts', source: 'export default 1;' }
  ]);
  const results: NativeBenchmarkResult[] = [];
  const startedAt = performance.now();

  results.push(await runNativeBenchmark('native parser import scan', () => scanImportSpecifiersNative(source)));
  results.push(await runNativeBenchmark('native compiler analysis', () => analyzeCompilationNative(source)));
  results.push(await runNativeBenchmark('native graph invalidation', () => invalidateChunkGraphNative(graph, 'src/dep.ts')));
  results.push(await runNativeBenchmark('native websocket packet', () => {
    const packet = encodeRuntimePacketNative(1, fnv1a32(source), source);
    decodeRuntimePacketNative(packet);
  }));
  results.push(await runNativeBenchmark('native runtime patch diff', () => diffRuntimePatchNative(source, `${source}\nconsole.log('hmr');`)));
  results.push(await runNativeBenchmark('native hmr batch', () => createNativeHmrBatch(graph.modules, 'src/dep.ts', source, `${source}\nconsole.log('hmr');`)));
  results.push(await runNativeBenchmark('native arena allocation', () => {
    for (let index = 0; index < 128; index += 1) {
      arena.allocate(128);
    }
    arena.reset();
  }));
  results.push(await runNativeBenchmark('native object pool', () => {
    const pool = new ObjectPool(() => ({ value: 0 }), value => {
      value.value = 0;
    });
    for (let index = 0; index < 128; index += 1) {
      const item = pool.acquire();
      item.value = index;
      pool.release(item);
    }
  }));

  return {
    generatedAt: new Date().toISOString(),
    totalMs: Number((performance.now() - startedAt).toFixed(3)),
    results,
    memory: {
      heapUsed: process.memoryUsage().heapUsed,
      arenaBytes: arena.capacity
    }
  };
};
