import { onBeforeUnmount, onMounted } from 'vue';

import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { useRecoveryStore } from '@/stores/recoveryStore';
import { STORAGE_KEYS } from '@/utils/storage';

const WATCHED_KEYS = new Set<string>([
  STORAGE_KEYS.items,
  STORAGE_KEYS.exchanges,
  STORAGE_KEYS.pendingBatches,
]);

/**
 * 监听其它标签页的写入：一旦物品、交换或待恢复批次发生变化，
 * 立刻用存储中的最新有效版本刷新本页，避免旧页面把结果盖回去。
 */
export const useRemoteRefresh = () => {
  const itemStore = useItemStore();
  const exchangeStore = useExchangeStore();
  const recoveryStore = useRecoveryStore();

  const handler = async (event: StorageEvent) => {
    if (!event.key || !WATCHED_KEYS.has(event.key)) return;
    if (event.key === STORAGE_KEYS.items) {
      await itemStore.hydrate();
    } else if (event.key === STORAGE_KEYS.exchanges) {
      await exchangeStore.hydrate();
    } else if (event.key === STORAGE_KEYS.pendingBatches) {
      await recoveryStore.hydrate();
    }
  };

  onMounted(() => window.addEventListener('storage', handler));
  onBeforeUnmount(() => window.removeEventListener('storage', handler));
};
