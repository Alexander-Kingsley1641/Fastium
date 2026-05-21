import { fnv1a32 } from '../hashing/index.js';
import { BinaryTable, createByteArena } from '../memory/index.js';

export type NativeWatchEvent = 1 | 2 | 3;

export interface NativeWatchRecord {
  path: string;
  event: NativeWatchEvent;
  hash: number;
  timestamp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const encodeWatchRecordNative = (path: string, event: NativeWatchEvent, timestamp = Date.now()): Uint8Array => {
  const bytes = encoder.encode(path);
  const out = new Uint8Array(13 + bytes.length);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint8(0, event);
  view.setUint32(1, fnv1a32(bytes), false);
  view.setFloat64(5, timestamp, false);
  out.set(bytes, 13);
  return out;
};

export const decodeWatchRecordNative = (buffer: Uint8Array): NativeWatchRecord | undefined => {
  if (buffer.byteLength < 13) {
    return undefined;
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  return {
    event: view.getUint8(0) as NativeWatchEvent,
    hash: view.getUint32(1, false),
    timestamp: view.getFloat64(5, false),
    path: decoder.decode(buffer.subarray(13))
  };
};

export const createNativeWatchBuffer = (capacity = 1024) => {
  const table = new BinaryTable(capacity);
  const arena = createByteArena(Math.max(64 * 1024, capacity * 128));
  const records: NativeWatchRecord[] = [];

  return {
    push(path: string, event: NativeWatchEvent): void {
      const hash = fnv1a32(path);
      table.set(path, event);
      const encoded = encodeWatchRecordNative(path, event);
      const slot = arena.allocate(encoded.byteLength);
      slot.set(encoded);
      records.push({ path, event, hash, timestamp: Date.now() });
      if (records.length > capacity) {
        records.shift();
      }
    },
    drain(): NativeWatchRecord[] {
      const drained = records.slice();
      records.length = 0;
      arena.reset();
      return drained;
    },
    stats() {
      return {
        pending: records.length,
        table: table.stats(),
        arena: {
          capacity: arena.capacity,
          used: arena.used(),
          shared: arena.shared
        }
      };
    },
    clear() {
      records.length = 0;
      table.clear();
      arena.reset();
    }
  };
};

export const shouldIgnoreNativePath = (filePath: string): boolean => {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.includes('/node_modules/')
    || normalized.includes('/.git/')
    || normalized.includes('/dist/')
    || normalized.includes('/testing-lab/')
    || normalized.endsWith('.tsbuildinfo');
};
