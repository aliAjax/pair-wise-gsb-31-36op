import { defineStore } from 'pinia';

import { commitApi, type ExchangeTransitionRequest, type OfflineItemRequest, type CreateExchangeRequest } from '@/api/commitApi';
import { CommitBatchStatus, CommitKind, COMMIT_ACTION_LABELS } from '@/constants/commit';
import type { CommitBatch, ConflictDetail } from '@/models/commitBatch';
import { isCommitConflictError } from '@/utils/commitError';
import { message } from '@/utils/message';

export type ConflictScope = string;

export interface StoredConflict {
  scope: ConflictScope;
  kind: CommitKind;
  conflicts: ConflictDetail[];
  at: number;
}

export const useCommitStore = defineStore('commit', {
  state: () => ({
    batches: [] as CommitBatch[],
    conflicts: [] as StoredConflict[],
    busy: false,
    hydrated: false,
  }),
  getters: {
    pendingBatches: (state) => state.batches.filter((batch) => batch.status === CommitBatchStatus.PENDING),
    failedBatches: (state) => state.batches.filter((batch) => batch.status === CommitBatchStatus.FAILED_CONFLICT),
    conflictOf: (state) => (scope: ConflictScope) =>
      state.conflicts.find((entry) => entry.scope === scope) ?? null,
  },
  actions: {
    async loadBatches() {
      this.batches = await commitApi.listBatches();
    },

    setConflict(scope: ConflictScope, kind: CommitKind, conflicts: ConflictDetail[]) {
      this.conflicts = [
        ...this.conflicts.filter((entry) => entry.scope !== scope),
        { scope, kind, conflicts, at: Date.now() },
      ];
    },

    clearConflict(scope: ConflictScope) {
      this.conflicts = this.conflicts.filter((entry) => entry.scope !== scope);
    },

    /**
     * 统一提交流程：交换与物品状态一起成功；守卫失败（页面落后）不产生批次，
     * 落库中断则留下可重试批次，交换记录用预生成 id 保证重试不重复。
     * 返回 boolean，false 表示页面需要保留输入并展示对方改动。
     */
    async run(scope: ConflictScope, kind: CommitKind, prepare: () => Promise<CommitBatch>): Promise<boolean> {
      this.busy = true;
      try {
        // 先尝试恢复上次中断的批次，避免新批次排在半完成批次后面
        await this.recoverPending(false);
        const draft = await prepare();
        await commitApi.submit(draft);
        await this.afterCommit();
        this.clearConflict(scope);
        return true;
      } catch (error) {
        if (isCommitConflictError(error)) {
          await this.afterCommit();
          this.setConflict(scope, kind, error.conflicts);
          return false;
        }
        await this.loadBatches();
        message('提交中断，已保留为可重试批次', 'error');
        return false;
      } finally {
        this.busy = false;
      }
    },

    async createExchange(scope: ConflictScope, request: CreateExchangeRequest): Promise<boolean> {
      return this.run(scope, CommitKind.CREATE_EXCHANGE, () => commitApi.prepareCreate(request));
    },

    async acceptExchange(scope: ConflictScope, request: ExchangeTransitionRequest): Promise<boolean> {
      return this.run(scope, CommitKind.ACCEPT_EXCHANGE, () =>
        commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, request),
      );
    },

    async rejectExchange(scope: ConflictScope, request: ExchangeTransitionRequest): Promise<boolean> {
      return this.run(scope, CommitKind.REJECT_EXCHANGE, () =>
        commitApi.prepareTransition(CommitKind.REJECT_EXCHANGE, request),
      );
    },

    async completeExchange(scope: ConflictScope, request: ExchangeTransitionRequest): Promise<boolean> {
      return this.run(scope, CommitKind.COMPLETE_EXCHANGE, () =>
        commitApi.prepareTransition(CommitKind.COMPLETE_EXCHANGE, request),
      );
    },

    async offlineItem(scope: ConflictScope, request: OfflineItemRequest): Promise<boolean> {
      return this.run(scope, CommitKind.OFFLINE_ITEM, () => commitApi.prepareOffline(request));
    },

    /** 启动 / storage 事件 / 手动重试时调用，把中断批次幂等地补完 */
    async recoverPending(showToast = true) {
      const summary = await commitApi.recoverPending();
      await this.loadBatches();
      if (summary.committed.length) {
        await this.afterCommit();
        if (showToast) {
          message(`已恢复 ${summary.committed.length} 笔未完成的提交`, 'success');
        }
      }
      summary.failed.forEach((batch) => {
        this.setConflict(`batch:${batch.id}`, batch.kind, batch.conflicts);
      });
      this.hydrated = true;
      return summary;
    },

    async retryBatch(id: string) {
      const batch = this.batches.find((entry) => entry.id === id);
      if (!batch) return;
      if (batch.status === CommitBatchStatus.PENDING) {
        await this.recoverPending(true);
        return;
      }
      // 守卫冲突后的批次不能用旧修订继续，提示用户基于新数据重新操作
      this.clearConflict(`batch:${id}`);
      await commitApi.discardBatch(id);
      await this.loadBatches();
      message('该笔提交基于旧数据，请按页面最新内容重新操作', 'info');
    },

    async discardBatch(id: string) {
      this.clearConflict(`batch:${id}`);
      await commitApi.discardBatch(id);
      await this.loadBatches();
    },

    /** 任何提交后三个实体 store 都以存储为唯一有效版本重新读取 */
    async afterCommit() {
      const { useItemStore } = await import('@/stores/itemStore');
      const { useExchangeStore } = await import('@/stores/exchangeStore');
      await Promise.all([useItemStore().hydrate(), useExchangeStore().hydrate()]);
      await this.loadBatches();
    },

    actionLabel(kind: CommitKind): string {
      return COMMIT_ACTION_LABELS[kind];
    },
  },
});
