import { createStore, del, get, keys, set, type UseStore } from "idb-keyval";

/** Tiny key-value storage interface so tests can swap in memory storage. */
export interface KeyValueStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

export class MemoryStorage implements KeyValueStorage {
  readonly data = new Map<string, unknown>();
  async get<T>(key: string) {
    const v = this.data.get(key);
    return v === undefined ? undefined : (structuredClone(v) as T);
  }
  async set(key: string, value: unknown) {
    this.data.set(key, structuredClone(value));
  }
  async del(key: string) {
    this.data.delete(key);
  }
  async keys(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** Browser storage (IndexedDB). Only call this in the browser. */
export class IndexedDbStorage implements KeyValueStorage {
  private store: UseStore | null = null;
  private db() {
    this.store ??= createStore("mymusic", "cache");
    return this.store;
  }
  get<T>(key: string) {
    return get<T>(key, this.db());
  }
  set(key: string, value: unknown) {
    return set(key, value, this.db());
  }
  del(key: string) {
    return del(key, this.db());
  }
  async keys(prefix: string) {
    const all = await keys(this.db());
    return all.filter((k): k is string => typeof k === "string" && k.startsWith(prefix));
  }
}
