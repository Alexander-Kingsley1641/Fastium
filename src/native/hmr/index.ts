import { diffRuntimePatchNative } from '../compiler/index.js';
import { invalidateGraphNative, type NativeGraphInput } from '../graph/index.js';
import { fnv1a32 } from '../hashing/index.js';
import { encodeRuntimePacketNative } from '../websocket/index.js';

export interface NativeHmrPatch {
  moduleId: string;
  hash: number;
  ranges: Uint32Array;
  packet: Uint8Array;
}

export interface NativeHmrBatch {
  id: number;
  patches: NativeHmrPatch[];
  affected: string[];
  durationMs: number;
}

export const createNativeHmrPatch = (moduleId: string, previousCode: string, nextCode: string): NativeHmrPatch => {
  const ranges = diffRuntimePatchNative(previousCode, nextCode);
  const hash = fnv1a32(nextCode);
  const packet = encodeRuntimePacketNative(2, hash, ranges.byteLength === 0 ? nextCode : new Uint8Array(ranges.buffer, ranges.byteOffset, ranges.byteLength));

  return {
    moduleId,
    hash,
    ranges,
    packet
  };
};

export const createNativeHmrBatch = (graph: NativeGraphInput[], changedId: string, previousCode: string, nextCode: string): NativeHmrBatch => {
  const startedAt = performance.now();
  const invalidation = invalidateGraphNative(graph, changedId);
  const patches = invalidation.affected.map(moduleId => createNativeHmrPatch(moduleId, previousCode, nextCode));

  return {
    id: fnv1a32(`${changedId}:${Date.now()}`),
    patches,
    affected: invalidation.affected,
    durationMs: performance.now() - startedAt
  };
};
