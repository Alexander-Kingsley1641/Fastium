export { createCache, createPersistentCache, isTransformCacheRecordFresh, readFileMetadata } from '../../cache/index.js';
export { BinaryTable } from '../memory/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface NativeCacheRecord {
  key: string;
  hash: number;
  payload: Uint8Array;
}

export const serializeCacheRecordNative = (key: string, payload: string | Uint8Array, hash: number): Uint8Array => {
  const keyBytes = encoder.encode(key);
  const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const buffer = new Uint8Array(12 + keyBytes.length + payloadBytes.length);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint32(0, keyBytes.length, false);
  view.setUint32(4, payloadBytes.length, false);
  view.setUint32(8, hash >>> 0, false);
  buffer.set(keyBytes, 12);
  buffer.set(payloadBytes, 12 + keyBytes.length);
  return buffer;
};

export const deserializeCacheRecordNative = (buffer: Uint8Array): NativeCacheRecord | undefined => {
  if (buffer.byteLength < 12) {
    return undefined;
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const keyLength = view.getUint32(0, false);
  const payloadLength = view.getUint32(4, false);
  const hash = view.getUint32(8, false);
  const payloadStart = 12 + keyLength;
  const payloadEnd = payloadStart + payloadLength;
  if (payloadEnd > buffer.byteLength) {
    return undefined;
  }

  return {
    key: decoder.decode(buffer.subarray(12, payloadStart)),
    hash,
    payload: buffer.subarray(payloadStart, payloadEnd)
  };
};
