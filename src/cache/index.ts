import { readFile, stat, writeFile } from 'node:fs/promises';

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
  size: number;
  hits: number;
  createdAt: number;
  lastAccess: number;
}

const isExpired = <V>(entry: CacheEntry<V>): boolean => entry.expiresAt !== null && Date.now() > entry.expiresAt;

export class MemoryCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly options: CacheOptions = {}) {}

  set(key: K, value: V, ttlMs = this.options.ttlMs): void {
    if (this.options.maxEntries && this.store.size >= this.options.maxEntries) {
      const firstKey = this.store.keys().next().value as K | undefined;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    const expiresAt = typeof ttlMs === 'number' ? Date.now() + ttlMs : null;
    const now = Date.now();
    this.store.set(key, { value, expiresAt, size: estimateSize(value), hits: 0, createdAt: now, lastAccess: now });
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }

    if (isExpired(entry)) {
      this.store.delete(key);
      this.misses += 1;
      return undefined;
    }

    this.hits += 1;
    entry.hits += 1;
    entry.lastAccess = Date.now();
    this.touch(key);
    return entry.value;
  }

  // LRU touch: mark key as recently used
  touch(key: K): void {
    const entry = this.store.get(key);
    if (!entry) return;
    this.store.delete(key);
    this.store.set(key, entry);
  }

  has(key: K): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: K): boolean {
    return this.store.delete(key);
  }

  invalidate(key: K): boolean {
    return this.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  sweep(): number {
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (isExpired(entry)) {
        this.store.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  snapshot(): Array<{ key: K; value: V }> {
    const entries: Array<{ key: K; value: V }> = [];
    for (const [key, entry] of this.store.entries()) {
      if (!isExpired(entry)) {
        entries.push({ key, value: entry.value });
      }
    }

    return entries;
  }

  stats(): { entries: number; hits: number; misses: number; estimatedBytes: number } {
    let estimatedBytes = 0;
    for (const entry of this.store.values()) {
      estimatedBytes += entry.size;
    }

    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      estimatedBytes
    };
  }

  getOrSet(key: K, factory: () => V, ttlMs = this.options.ttlMs): V {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = factory();
    this.set(key, value, ttlMs);
    return value;
  }
}

export interface FileCacheMetadata {
  filePath: string;
  size: number;
  mtimeMs: number;
  hash?: string;
}

export interface TransformCacheRecord<V> {
  value: V;
  metadata: FileCacheMetadata;
  dependencies: Record<string, FileCacheMetadata>;
}

const estimateSize = (value: unknown): number => {
  if (typeof value === 'string') {
    return value.length * 2;
  }

  if (value instanceof Uint8Array) {
    return value.byteLength;
  }

  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
};

export const readFileMetadata = async (filePath: string, hash?: string): Promise<FileCacheMetadata | undefined> => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      return undefined;
    }

    return {
      filePath,
      size: fileStat.size,
      mtimeMs: fileStat.mtimeMs,
      hash
    };
  } catch {
    return undefined;
  }
};

export const isFileMetadataFresh = async (metadata: FileCacheMetadata | undefined): Promise<boolean> => {
  if (!metadata) {
    return false;
  }

  const current = await readFileMetadata(metadata.filePath);
  return Boolean(current && current.size === metadata.size && current.mtimeMs === metadata.mtimeMs);
};

export const isTransformCacheRecordFresh = async <V>(record: TransformCacheRecord<V> | undefined): Promise<boolean> => {
  if (!record || !(await isFileMetadataFresh(record.metadata))) {
    return false;
  }

  for (const dependency of Object.values(record.dependencies)) {
    if (!(await isFileMetadataFresh(dependency))) {
      return false;
    }
  }

  return true;
};

export class PersistentCache<V> {
  private readonly memory: MemoryCache<string, V>;

  constructor(private readonly filePath: string, options: CacheOptions = {}) {
    this.memory = new MemoryCache<string, V>(options);
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Array<{ key: string; value: V }>;
      this.memory.clear();
      for (const entry of parsed) {
        this.memory.set(entry.key, entry.value);
      }
    } catch {
      return;
    }
  }

  async save(): Promise<void> {
    const payload = JSON.stringify(this.memory.snapshot(), null, 2);
    await writeFile(this.filePath, payload, 'utf8');
  }

  set(key: string, value: V): void {
    this.memory.set(key, value);
  }

  get(key: string): V | undefined {
    return this.memory.get(key);
  }

  delete(key: string): boolean {
    return this.memory.delete(key);
  }

  clear(): void {
    this.memory.clear();
  }
}

export const createCache = <K, V>(options: CacheOptions = {}) => new MemoryCache<K, V>(options);
export const createPersistentCache = <V>(filePath: string, options: CacheOptions = {}) => new PersistentCache<V>(filePath, options);
