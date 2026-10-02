import type { Router } from 'vue-router';

import { ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import { LOG_MESSAGES } from '@/constants/messages';
import { storage } from '@/utils/storage';
import { useAuthStore } from '@/stores/authStore';
import { useCommitStore } from '@/stores/commitStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';

export const setupRouterGuards = (router: Router) => {
  router.beforeEach(async () => {
    const authStore = useAuthStore();
    const itemStore = useItemStore();
    const exchangeStore = useExchangeStore();
    const commitStore = useCommitStore();

    // 直接通过地址栏进入时，App.onMounted 可能尚未完成迁移
    await storage.migrate();

    if (!authStore.currentUser) {
      await authStore.hydrate();
    }
    if (!itemStore.items.length) {
      await itemStore.hydrate();
    }
    if (!exchangeStore.exchanges.length) {
      await exchangeStore.hydrate();
    }
    if (!commitStore.hydrated) {
      await commitStore.recoverPending(false);
    }

    const statusProbe = itemStore.items.some(
      (item) => item.status === ItemStatus.AVAILABLE || item.status === ItemStatus.BOOKED,
    );
    const exchangeProbe = exchangeStore.exchanges.some((item) => item.status === ExchangeStatus.PENDING);
    if (import.meta.env.DEV && (statusProbe || exchangeProbe)) {
      console.debug(LOG_MESSAGES.storageHydrated);
    }
    return true;
  });
};
