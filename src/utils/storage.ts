import { del, get, set } from 'idb-keyval';

import { migratePayload } from '@/utils/migrations';
import type { PersistedEnvelope } from '@/types';

const STORAGE_VERSION = 2;
const DEFAULT_TTL = 1000 * 60 * 60 * 24 * 365;

const prefixed = (key: string) => `reswap:${key}`;

export const STORAGE_KEYS = {
  currentUserId: prefixed('current-user-id'),
  users: prefixed('users'),
  items: prefixed('items'),
  exchanges: prefixed('exchanges'),
  theme: prefixed('theme'),
  lastClean: prefixed('last-clean'),
  /** 失败后留下的可重试提交批次 */
  pendingBatches: prefixed('pending-batches'),
} as const;

const now = () => Date.now();

const envelope = <T>(payload: T, ttl = DEFAULT_TTL): PersistedEnvelope<T> => ({
  version: STORAGE_VERSION,
  expiresAt: now() + ttl,
  payload,
});

const toPlain = <T>(payload: T): T => JSON.parse(JSON.stringify(payload)) as T;

const isExpired = <T>(data: PersistedEnvelope<T> | null) => {
  if (!data) return false;
  return Boolean(data.expiresAt && data.expiresAt < now());
};

const parseLocal = <T>(key: string): PersistedEnvelope<T> | null => {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedEnvelope<T>;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
};

const writeLocal = <T>(key: string, payload: T, ttl?: number) => {
  localStorage.setItem(key, JSON.stringify(envelope(payload, ttl)));
};

/**
 * 旧版本数据先迁移到当前版本，并补齐修订信息（revision / updated_at）。
 * 无论数据来自 localStorage 还是 IndexedDB，读取时统一走一遍。
 */
const upgrade = <T>(key: string, data: PersistedEnvelope<T>): PersistedEnvelope<T> => {
  if (data.version === STORAGE_VERSION) return data;
  const migrated = migratePayload(key, data.payload, data.version);
  return { ...data, version: STORAGE_VERSION, payload: migrated };
};

export const storage = {
  async get<T>(key: string, fallback: T): Promise<T> {
    const localEnvelope = parseLocal<T>(key);
    if (isExpired(localEnvelope)) {
      await this.remove(key);
      return fallback;
    }
    if (localEnvelope && localEnvelope.version <= STORAGE_VERSION) {
      const upgraded = upgrade(key, localEnvelope);
      if (upgraded.version === STORAGE_VERSION) {
        if (upgraded !== localEnvelope) writeLocal(key, upgraded.payload);
        return upgraded.payload;
      }
    }

    const indexedEnvelope = await get<PersistedEnvelope<T>>(key);
    if (isExpired(indexedEnvelope ?? null)) {
      await this.remove(key);
      return fallback;
    }
    if (indexedEnvelope && indexedEnvelope.version <= STORAGE_VERSION) {
      const upgraded = upgrade(key, indexedEnvelope);
      if (upgraded.version === STORAGE_VERSION) {
        writeLocal(key, upgraded.payload);
        return upgraded.payload;
      }
    }
    return fallback;
  },

  async set<T>(key: string, payload: T, ttl?: number): Promise<T> {
    const plainPayload = toPlain(payload);
    const packed = envelope(plainPayload, ttl);
    localStorage.setItem(key, JSON.stringify(packed));
    await set(key, packed);
    return plainPayload;
  },

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
    await del(key);
  },

  /** 键是否存在（localStorage 与 IndexedDB 任一有数据即可），用于区分"空数组"与"从未初始化" */
  async has<T = unknown>(key: string): Promise<boolean> {
    const localEnvelope = parseLocal<T>(key);
    if (localEnvelope && !isExpired(localEnvelope)) return true;
    const indexedEnvelope = await get<PersistedEnvelope<T>>(key);
    return Boolean(indexedEnvelope && !isExpired(indexedEnvelope));
  },

  async cleanExpired(): Promise<void> {
    const keys = Object.values(STORAGE_KEYS);
    await Promise.all(
      keys.map(async (key) => {
        const localEnvelope = parseLocal<unknown>(key);
        if (isExpired(localEnvelope)) {
          await this.remove(key);
        }
      }),
    );
    localStorage.setItem(STORAGE_KEYS.lastClean, JSON.stringify(envelope(new Date().toISOString())));
  },

  createId(prefix: string): string {
    return `${prefix}_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;
  },
};
