import { defineStore } from 'pinia';

import { exchangeApi } from '@/api/exchangeApi';
import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange, ExchangeDraft } from '@/models/exchange';
import { useCommitStore } from '@/stores/commitStore';
import { message } from '@/utils/message';

export const useExchangeStore = defineStore('exchanges', {
  state: () => ({
    exchanges: [] as Exchange[],
    statusFilter: 'all' as ExchangeStatus | 'all',
    loading: false,
  }),
  getters: {
    sent: (state) => (userId: string) => state.exchanges.filter((item) => item.from_user_id === userId),
    received: (state) => (userId: string) => state.exchanges.filter((item) => item.to_user_id === userId),
    filtered: (state) => {
      if (state.statusFilter === 'all') return state.exchanges;
      return state.exchanges.filter((item) => item.status === state.statusFilter);
    },
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.exchanges = await exchangeApi.list();
      } finally {
        this.loading = false;
      }
    },

    /**
     * 发起交换属于可恢复提交：页面必须携带两侧物品的修订号，
     * 旧页面覆盖不了新结果；成功与否由 commitStore 原子保证。
     * 输入是否清空由页面依据返回值决定（false 时保留）。
     */
    async create(
      draft: ExchangeDraft,
      revisions: { fromItemRevision: number; toItemRevision: number },
      scope: string,
    ): Promise<boolean> {
      const commitStore = useCommitStore();
      const ok = await commitStore.createExchange(scope, {
        from_user_id: draft.from_user_id,
        to_user_id: draft.to_user_id,
        from_item_id: draft.from_item_id,
        to_item_id: draft.to_item_id,
        message: draft.message,
        expected_from_item_revision: revisions.fromItemRevision,
        expected_to_item_revision: revisions.toItemRevision,
      });
      if (ok) message('交换请求已发出', 'success');
      return ok;
    },

    async accept(
      id: string,
      revisions: { exchangeRevision: number; fromItemRevision: number; toItemRevision: number },
      scope = `exchange:${id}`,
    ): Promise<boolean> {
      const ok = await useCommitStore().acceptExchange(scope, {
        exchangeId: id,
        expectedExchangeRevision: revisions.exchangeRevision,
        expectedFromItemRevision: revisions.fromItemRevision,
        expectedToItemRevision: revisions.toItemRevision,
      });
      if (ok) message('已同意交换，双方物品已锁定', 'success');
      return ok;
    },

    async reject(
      id: string,
      revisions: { exchangeRevision: number; fromItemRevision: number; toItemRevision: number },
      scope = `exchange:${id}`,
    ): Promise<boolean> {
      const ok = await useCommitStore().rejectExchange(scope, {
        exchangeId: id,
        expectedExchangeRevision: revisions.exchangeRevision,
        expectedFromItemRevision: revisions.fromItemRevision,
        expectedToItemRevision: revisions.toItemRevision,
      });
      if (ok) message('已拒绝交换', 'success');
      return ok;
    },

    async complete(
      id: string,
      revisions: { exchangeRevision: number; fromItemRevision: number; toItemRevision: number },
      scope = `exchange:${id}`,
    ): Promise<boolean> {
      const ok = await useCommitStore().completeExchange(scope, {
        exchangeId: id,
        expectedExchangeRevision: revisions.exchangeRevision,
        expectedFromItemRevision: revisions.fromItemRevision,
        expectedToItemRevision: revisions.toItemRevision,
      });
      if (ok) message('交换已完成，双方物品状态已更新', 'success');
      return ok;
    },
  },
});
