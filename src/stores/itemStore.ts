import { defineStore } from 'pinia';
import { orderBy } from 'lodash-es';

import { itemApi } from '@/api/itemApi';
import { ItemStatus } from '@/constants/item';
import { FORM_MESSAGES } from '@/constants/messages';
import type { Item, ItemDraft } from '@/models/item';
import { useCommitStore } from '@/stores/commitStore';
import { message } from '@/utils/message';
import { validateItemDraft } from '@/utils/validators';

export const useItemStore = defineStore('items', {
  state: () => ({
    items: [] as Item[],
    keyword: '',
    category: '全部',
    statusFilter: ItemStatus.AVAILABLE as ItemStatus,
    loading: false,
  }),
  getters: {
    visibleItems: (state) => {
      return orderBy(
        state.items.filter((item) => {
          const categoryMatched = state.category === '全部' || item.category === state.category;
          const keywordMatched = `${item.title}${item.description}${item.location}`
            .toLowerCase()
            .includes(state.keyword.toLowerCase());
          return categoryMatched && keywordMatched && item.status === state.statusFilter;
        }),
        ['created_at'],
        ['desc'],
      );
    },
    myItems: (state) => (userId: string) => state.items.filter((item) => item.user_id === userId),
    /** 只有可交换状态能再次发起交换；已锁定（已同意未完成）的物品不会再出现 */
    availableMyItems: (state) => (userId: string) =>
      state.items.filter((item) => item.user_id === userId && item.status === ItemStatus.AVAILABLE),
  },
  actions: {
    async hydrate() {
      this.loading = true;
      try {
        this.items = await itemApi.list();
      } finally {
        this.loading = false;
      }
    },
    async publish(draft: ItemDraft) {
      const error = validateItemDraft(draft);
      if (error) {
        message(error, 'error');
        return null;
      }
      const item = await itemApi.create({
        user_id: draft.user_id,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        condition: draft.condition,
        images: [...draft.images],
        location: draft.location,
        status: ItemStatus.AVAILABLE,
      });
      this.items = await itemApi.list();
      message('物品已发布，等待合适的交换', 'success');
      return item;
    },

    /**
     * 下架是可恢复提交：带上物品修订号，以及页面上引用该物品的待确认交换修订号，
     * 下架与“拒绝相关交换”在同一批次里一起成功。页面落后则保留输入并列出对方改动。
     */
    async offline(
      itemId: string,
      revision: number,
      pendingExchangeRevisions: Array<{ id: string; revision: number }> = [],
      scope = `item:${itemId}`,
    ): Promise<boolean> {
      const commitStore = useCommitStore();
      const ok = await commitStore.offlineItem(scope, {
        itemId,
        expectedItemRevision: revision,
        pendingExchanges: pendingExchangeRevisions,
      });
      if (ok) message('物品已下架', 'success');
      return ok;
    },

    assertCanExchange(userId: string) {
      const ownItems = this.availableMyItems(userId);
      if (!ownItems.length) {
        message(FORM_MESSAGES.exchangeNeedOwnItem, 'error');
        return false;
      }
      return true;
    },
  },
});
