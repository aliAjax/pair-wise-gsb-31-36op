import { defineStore } from 'pinia';

import { exchangeApi } from '@/api/exchangeApi';
import { ExchangeStatus } from '@/constants/exchange';
import type {
  Exchange,
  ExchangeDraft,
  ExchangeExpectedRefs,
  ExchangeSubmitPayload,
} from '@/models/exchange';
import { useItemStore } from '@/stores/itemStore';
import { useRecoveryStore } from '@/stores/recoveryStore';
import { message } from '@/utils/message';
import { createExchangeOperation, transitionExchangeOperation } from '@/utils/revisionHelpers';

export const useExchangeStore = defineStore('exchanges', {
  state: () => ({
    exchanges: [] as Exchange[],
    statusFilter: 'all' as ExchangeStatus | 'all',
    loading: false,
    hydrated: false,
  }),
  getters: {
    sent: (state) => (userId: string) => state.exchanges.filter((item) => item.from_user_id === userId),
    received: (state) => (userId: string) =>
      state.exchanges.filter((item) => item.to_user_id === userId),
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
        this.hydrated = true;
      } finally {
        this.loading = false;
      }
    },

    /** 发起交换：携带两侧物品修订信息，失败重试不重复生成交换记录 */
    async create(draft: ExchangeDraft, refs: ExchangeExpectedRefs) {
      const recovery = useRecoveryStore();
      const outcome = await recovery.submit(createExchangeOperation({ ...draft }, refs));
      const itemStore = useItemStore();
      await Promise.all([this.hydrate(), itemStore.hydrate()]);
      if (outcome.ok) {
        message('交换请求已发出', 'success');
      }
      // 冲突或失败：表单输入由页面保留，批次在交换页可重试
      return outcome;
    },

    /** 同意/拒绝/完成：交换与两侧物品一起成功，否则留下可重试批次 */
    async decide(exchange: Exchange, payload: ExchangeSubmitPayload, successText: string) {
      const recovery = useRecoveryStore();
      const result = await recovery.submit(transitionExchangeOperation(exchange.id, payload));
      const itemStore = useItemStore();
      await Promise.all([this.hydrate(), itemStore.hydrate()]);
      if (result.ok) {
        message(successText, 'success');
      }
      return result;
    },

    async accept(exchange: Exchange, payload: ExchangeSubmitPayload) {
      return this.decide(exchange, payload, '已同意交换');
    },
    async reject(exchange: Exchange, payload: ExchangeSubmitPayload) {
      return this.decide(exchange, payload, '已拒绝交换');
    },
    async complete(exchange: Exchange, payload: ExchangeSubmitPayload) {
      return this.decide(exchange, payload, '交换已完成，双方物品状态已更新');
    },
  },
});
