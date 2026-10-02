import { onBeforeUnmount, onMounted } from 'vue';

import { COMMIT_STORAGE_HINTS } from '@/constants/commit';
import { STORAGE_KEYS } from '@/utils/storage';
import { useCommitStore } from '@/stores/commitStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';

const WATCHED_KEYS = new Set<string>([
  STORAGE_KEYS.items,
  STORAGE_KEYS.exchanges,
  STORAGE_KEYS.commitOutbox,
]);

/**
 * 监听其他标签页的写入：实体 key 变化时以存储为唯一有效版本重新 hydrate，
 * outbox 变化时先恢复中断批次。首页、详情、交换页借此认同一版本，
 * 旧页面不会再把刚写入的结果盖回去。
 */
export const useStorageSync = () => {
  const sync = async (key: string | null) => {
    const commitStore = useCommitStore();
    const itemStore = useItemStore();
    const exchangeStore = useExchangeStore();
    if (key === STORAGE_KEYS.commitOutbox || key === null) {
      const summary = await commitStore.recoverPending(false);
      // 别的标签页提交完成会删掉 outbox 批次；即使没恢复到批次，也以存储最新版本为准
      if (summary.committed.length || key === STORAGE_KEYS.commitOutbox) {
        await Promise.all([itemStore.hydrate(), exchangeStore.hydrate()]);
      }
      return;
    }
    if (key === STORAGE_KEYS.items) {
      await itemStore.hydrate();
    }
    if (key === STORAGE_KEYS.exchanges) {
      await exchangeStore.hydrate();
    }
  };

  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const onStorage = (event: StorageEvent) => {
    if (!event.key || !WATCHED_KEYS.has(event.key)) return;
    if (event.key === COMMIT_STORAGE_HINTS.lockKey) return;
    if (scheduled) clearTimeout(scheduled);
    scheduled = setTimeout(() => void sync(event.key), 120);
  };

  onMounted(() => window.addEventListener('storage', onStorage));
  onBeforeUnmount(() => {
    window.removeEventListener('storage', onStorage);
    if (scheduled) clearTimeout(scheduled);
  });

  return { sync };
};
