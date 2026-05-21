import { readFile, writeFile } from 'node:fs/promises';

export interface CacheOptions {
  ttlMs?: number;
  maxEntries?: number;
}

interface CacheEntry<V> {
  value: V;
  expiresAt: number | null;
}

const isExpired = <V>(entry: CacheEntry<V>): boolean => entry.expiresAt !== null && Date.now() > entry.expiresAt;

export class MemoryCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>();

  constructor(private readonly options: CacheOptions = {}) {}

  set(key: K, value: V, ttlMs = this.options.ttlMs): void {
    if (this.options.maxEntries && this.store.size >= this.options.maxEntries) {
      const firstKey = this.store.keys().next().value as K | undefined;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }

    const expiresAt = typeof ttlMs === 'number' ? Date.now() + ttlMs : null;
    this.store.set(key, { value, expiresAt });
  }

  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }

    if (isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }

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
}

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