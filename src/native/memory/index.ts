export class ObjectPool<T> {
  private readonly free: T[] = [];

  constructor(private readonly create: () => T, private readonly reset: (value: T) => void = () => undefined, private readonly maxSize = 256) {}

  acquire(): T {
    return this.free.pop() ?? this.create();
  }

  release(value: T): void {
    if (this.free.length >= this.maxSize) {
      return;
    }

    this.reset(value);
    this.free.push(value);
  }

  clear(): void {
    this.free.length = 0;
  }

  size(): number {
    return this.free.length;
  }
}

export interface ByteArena {
  allocate: (length: number) => Uint8Array;
  reset: () => void;
  used: () => number;
  capacity: number;
  shared: boolean;
}

export const createByteArena = (size = 64 * 1024) => {
  const buffer = new ArrayBuffer(size);
  let offset = 0;

  return {
    allocate(length: number): Uint8Array {
      if (length > size) {
        return new Uint8Array(length);
      }

      if (offset + length > size) {
        offset = 0;
      }

      const view = new Uint8Array(buffer, offset, length);
      offset += length;
      return view;
    },
    reset() {
      offset = 0;
    },
    used() {
      return offset;
    },
    shared: false,
    capacity: size
  } satisfies ByteArena;
};

export const createSharedByteArena = (size = 64 * 1024): ByteArena => {
  if (typeof SharedArrayBuffer === 'undefined') {
    return createByteArena(size);
  }

  const buffer = new SharedArrayBuffer(size);
  let offset = 0;

  return {
    allocate(length: number) {
      if (length > size) {
        return new Uint8Array(length);
      }

      if (offset + length > size) {
        offset = 0;
      }

      const view = new Uint8Array(buffer, offset, length);
      offset += length;
      return view;
    },
    reset() {
      offset = 0;
    },
    used() {
      return offset;
    },
    capacity: size,
    shared: true
  };
};

export class BinaryTable {
  private readonly keys = new Map<string, number>();
  private readonly values: Uint32Array;
  private count = 0;

  constructor(capacity = 1024) {
    this.values = new Uint32Array(capacity);
  }

  set(key: string, value: number): void {
    let slot = this.keys.get(key);
    if (slot === undefined) {
      if (this.count >= this.values.length) {
        return;
      }

      slot = this.count;
      this.keys.set(key, slot);
      this.count += 1;
    }

    this.values[slot] = value >>> 0;
  }

  get(key: string): number | undefined {
    const slot = this.keys.get(key);
    return slot === undefined ? undefined : this.values[slot];
  }

  clear(): void {
    this.keys.clear();
    this.values.fill(0);
    this.count = 0;
  }

  stats(): { entries: number; capacity: number; bytes: number } {
    return {
      entries: this.count,
      capacity: this.values.length,
      bytes: this.values.byteLength
    };
  }
};
