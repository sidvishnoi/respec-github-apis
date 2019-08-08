import { join, dirname } from 'path';
import { promises as fs } from 'fs';
import { DATA_DIR } from './constants.js';

const { writeFile, readFile, mkdir } = fs;

const TTL = Number.MAX_SAFE_INTEGER;

interface CacheEntry<V> {
  time: number;
  value: V;
}

type Options =
  | string // name
  | Partial<{
      noEvict: boolean; // do not auto evict cache
      name: string;
    }>;

export class TTLCache<K, V> {
  private cache: Map<K, CacheEntry<V>>;
  private name?: string;
  public ttl: number;

  constructor(ttl = TTL, data?: [K, CacheEntry<V>][], opts?: Options) {
    this.cache = new Map(data);
    this.ttl = ttl;
    if (opts) {
      if (typeof opts === 'string') {
        this.name = opts;
      } else {
        this.name = opts.name || 'unnamed-cache';
        if (!opts.noEvict) {
          setInterval(this.invalidate.bind(this), this.ttl);
        }
      }
    }
  }

  set(key: K, value: V) {
    this.cache.set(key, { time: Date.now(), value });
    return this;
  }

  get(key: K, stale?: boolean) {
    if (!this.cache.has(key)) return null;
    const { time, value } = this.cache.get(key) as CacheEntry<V>;
    if (this.isBusted(time) && !stale) return null;
    return value;
  }

  has(key: K, stale?: boolean) {
    return this.get(key, stale) !== null;
  }

  invalidate() {
    for (const [key, { time }] of this.cache) {
      if (this.isBusted(time)) this.cache.delete(key);
    }
  }

  private isBusted(time: number) {
    return Date.now() - time > this.ttl;
  }

  get data() {
    return [...this.cache].filter(([, entry]) => !this.isBusted(entry.time));
  }

  async dump() {
    const file = join(DATA_DIR, `./${this.name}.json`);
    const data = JSON.stringify(this.data);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, data);
  }

  async load() {
    const file = join(DATA_DIR, `./${this.name}.json`);
    let entries: [K, CacheEntry<V>][] = [];
    try {
      const text = await readFile(file, 'utf-8');
      entries = JSON.parse(text);
    } catch (err) {
      console.warn(`Failed to load cache: ${this.name}.`, err.messsage);
    } finally {
      for (const [key, entry] of entries) {
        this.cache.set(key, entry);
      }
    }
    return this;
  }
}

// This helps us provide cache hit/miss stats, so we can dynamically adjust TTL
export class TTLCacheWithStats<K, V> extends TTLCache<K, V> {
  private _stats: { hit: number; miss: number };

  constructor(ttl = TTL, data?: [K, CacheEntry<V>][], opts: Options = {}) {
    super(ttl, data, opts);
    this._stats = { hit: 0, miss: 0 };
  }

  get(key: K, stale?: boolean) {
    const value = super.get(key, stale);
    if (value !== null) {
      this._stats.hit++;
    } else {
      this._stats.miss++;
    }
    return value;
  }

  get stats() {
    return this._stats;
  }

  clearStats() {
    this._stats.hit = this._stats.miss = 0;
  }

  setTTL(val: number) {
    this.ttl = val;
  }
}

export class ImmutableCache<K, V> extends TTLCache<K, V> {
  constructor(name: string) {
    super(TTL, undefined, name);
  }
}
