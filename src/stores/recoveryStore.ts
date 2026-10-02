import { defineStore } from 'pinia';

import { batchApi } from '@/api/batchApi';
import { CONFLICT_MESSAGES } from '@/constants/messages';
import type { BatchOperation, PendingBatch } from '@/types';
import { message } from '@/utils/message';
import { rebaseBatch } from '@/utils/rebaseBatch';
import { isRevisionMismatchError } from '@/utils/revision';
import { runBatchOperation } from '@/utils/runBatch';

const createBatchId = () =>
  `batch_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`;

interface SubmitOutcome {
  ok: boolean;
  conflicted: boolean;
  batch?: PendingBatch;
}

export const useRecoveryStore = defineStore('recovery', {
  state: () => ({
    batches: [] as PendingBatch[],
    running: false,
    hydrated: false,
  }),
  getters: {
    pendingBatches: (state) => state.batches,
    hasPending: (state) => state.batches.length > 0,
    conflictBatches: (state) => state.batches.filter((batch) => batch.state === 'conflict'),
  },
  actions: {
    async hydrate() {
      this.batches = await batchApi.list();
      this.hydrated = true;
    },

    /**
     * 提交一个可恢复批次。
     * 成功：清除批次；修订冲突：保留输入并记录对方改动；其它失败：留下可重试批次。
     */
    async submit(operation: BatchOperation): Promise<SubmitOutcome> {
      const batch: PendingBatch = {
        id: createBatchId(),
        created_at: new Date().toISOString(),
        attempts: 0,
        state: 'pending',
        operation,
      };
      this.running = true;
      try {
        await runBatchOperation(operation);
        this.batches = await batchApi.remove(batch.id);
        return { ok: true, conflicted: false };
      } catch (error) {
        if (isRevisionMismatchError(error)) {
          const conflicted: PendingBatch = {
            ...batch,
            state: 'conflict',
            attempts: 1,
            last_error: error.message,
            conflict: {
              at: new Date().toISOString(),
              details: error.details,
              changes: error.changes,
            },
          };
          this.batches = await batchApi.add(conflicted);
          message(CONFLICT_MESSAGES.stalePage, 'error');
          return { ok: false, conflicted: true, batch: conflicted };
        }
        const failed: PendingBatch = {
          ...batch,
          state: 'pending',
          attempts: 1,
          last_error: error instanceof Error ? error.message : '提交失败',
        };
        this.batches = await batchApi.add(failed);
        message(CONFLICT_MESSAGES.batchLeft, 'error');
        return { ok: false, conflicted: false, batch: failed };
      } finally {
        this.running = false;
      }
    },

    /** 基于最新数据重建修订信息后重试；仍是冲突则刷新对方改动列表 */
    async retry(batchId: string, silent = false): Promise<SubmitOutcome> {
      const batch = this.batches.find((item) => item.id === batchId);
      if (!batch) return { ok: false, conflicted: false };
      const rebased = await rebaseBatch(batch);
      if (!rebased) {
        this.batches = await batchApi.remove(batchId);
        if (!silent) message(CONFLICT_MESSAGES.batchDismissed, 'info');
        return { ok: false, conflicted: false };
      }
      this.running = true;
      try {
        await runBatchOperation(rebased.operation);
        this.batches = await batchApi.remove(batchId);
        if (!silent) message(CONFLICT_MESSAGES.batchRetried, 'success');
        return { ok: true, conflicted: false };
      } catch (error) {
        if (isRevisionMismatchError(error)) {
          const updated: PendingBatch = {
            ...rebased,
            state: 'conflict',
            last_error: error.message,
            conflict: {
              at: new Date().toISOString(),
              details: error.details,
              changes: error.changes,
            },
          };
          this.batches = await batchApi.update(batchId, updated);
          if (!silent) message(CONFLICT_MESSAGES.batchRetryStale, 'error');
          return { ok: false, conflicted: true, batch: updated };
        }
        const updated: PendingBatch = {
          ...rebased,
          state: 'pending',
          last_error: error instanceof Error ? error.message : '提交失败',
        };
        this.batches = await batchApi.update(batchId, updated);
        if (!silent) message(CONFLICT_MESSAGES.batchLeft, 'error');
        return { ok: false, conflicted: false, batch: updated };
      } finally {
        this.running = false;
      }
    },

    async dismiss(batchId: string) {
      this.batches = await batchApi.remove(batchId);
      message(CONFLICT_MESSAGES.batchDismissed, 'info');
    },

    /** 应用启动时回放仍是 pending（非冲突）的批次 */
    async recoverPending() {
      const pendings = this.batches.filter((batch) => batch.state === 'pending');
      for (const batch of pendings) {
        await this.retry(batch.id, true);
      }
    },
  },
});
