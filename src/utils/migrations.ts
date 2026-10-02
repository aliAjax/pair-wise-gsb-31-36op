import { INITIAL_EXCHANGE_REVISION } from '@/models/exchange';
import { INITIAL_ITEM_REVISION } from '@/models/item';

import { STORAGE_KEYS } from './storage';

interface LegacyItem {
  id: string;
  created_at?: string;
  updated_at?: string;
  revision?: number;
}

interface LegacyExchange {
  id: string;
  created_at?: string;
  updated_at?: string;
  revision?: number;
}

/**
 * 旧数据迁移：
 * - 物品补 updated_at 与 revision；
 * - 交换补 updated_at 与 revision。
 * 迁移只在读取时进行一次，随后由 storage 层以新版本写回。
 */
export const migratePayload = <T>(key: string, payload: T, fromVersion: number): T => {
  if (fromVersion >= 2) return payload;

  if (key === STORAGE_KEYS.items) {
    const items = (payload as LegacyItem[] | undefined) ?? [];
    return items.map((item) => ({
      ...item,
      updated_at: item.updated_at ?? item.created_at ?? new Date().toISOString(),
      revision: typeof item.revision === 'number' ? item.revision : INITIAL_ITEM_REVISION,
    })) as unknown as T;
  }

  if (key === STORAGE_KEYS.exchanges) {
    const exchanges = (payload as LegacyExchange[] | undefined) ?? [];
    return exchanges.map((exchange) => ({
      ...exchange,
      updated_at: exchange.updated_at ?? exchange.created_at ?? new Date().toISOString(),
      revision:
        typeof exchange.revision === 'number' ? exchange.revision : INITIAL_EXCHANGE_REVISION,
    })) as unknown as T;
  }

  return payload;
};
