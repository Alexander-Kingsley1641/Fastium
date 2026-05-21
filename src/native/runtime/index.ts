export { createSandbox } from '../../sandbox/index.js';
export { createFastium } from '../../runtime/index.js';
export { diffRuntimePatchNative } from '../compiler/index.js';

const ADD_WASM = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01,
  0x7f, 0x03, 0x02, 0x01, 0x00, 0x07, 0x07, 0x01,
  0x03, 0x61, 0x64, 0x64, 0x00, 0x00, 0x0a, 0x09,
  0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a,
  0x0b
]);

export interface NativeBridge {
  wasmEnabled: boolean;
  assemblyEnabled: boolean;
  add: (a: number, b: number) => number;
  memory: WebAssembly.Memory | undefined;
}

export const createNativeBridge = async (): Promise<NativeBridge> => {
  if (typeof WebAssembly === 'undefined' || !WebAssembly.validate(ADD_WASM)) {
    return {
      wasmEnabled: false,
      assemblyEnabled: false,
      add: (a, b) => a + b,
      memory: undefined
    };
  }

  const instance = await WebAssembly.instantiate(ADD_WASM);
  const add = (instance.instance.exports.add as ((a: number, b: number) => number) | undefined) ?? ((a: number, b: number) => a + b);

  return {
    wasmEnabled: true,
    assemblyEnabled: true,
    add,
    memory: undefined
  };
};

export interface NativeProfileSample {
  name: string;
  durationMs: number;
  heapUsed: number;
  retainedHeap: number;
}

export const profileNative = async <T>(name: string, run: () => T | Promise<T>): Promise<{ value: T; sample: NativeProfileSample }> => {
  const memoryBefore = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const value = await run();
  const durationMs = performance.now() - startedAt;
  const memoryAfter = process.memoryUsage().heapUsed;

  return {
    value,
    sample: {
      name,
      durationMs,
      heapUsed: memoryAfter,
      retainedHeap: memoryAfter - memoryBefore
    }
  };
};

export const createRuntimeProfilerNative = () => {
  const samples: NativeProfileSample[] = [];

  return {
    async measure<T>(name: string, run: () => T | Promise<T>): Promise<T> {
      const result = await profileNative(name, run);
      samples.push(result.sample);
      return result.value;
    },
    samples() {
      return samples.slice();
    },
    summary() {
      return {
        samples: samples.length,
        totalMs: samples.reduce((sum, sample) => sum + sample.durationMs, 0),
        retainedHeap: samples.reduce((sum, sample) => sum + sample.retainedHeap, 0)
      };
    },
    clear() {
      samples.length = 0;
    }
  };
};
