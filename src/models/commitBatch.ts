import { CommitBatchStatus, CommitKind, CommitReason } from '@/constants/commit';
import type { ExchangeStatus } from '@/constants/exchange';
import type { ItemStatus } from '@/constants/item';

/** 页面提交时携带的实体修订信息 */
export interface RevisionGuard {
  kind: 'exchange' | 'item';
  id: string;
  revision: number;
  /** 页面渲染该实体时看到的状态，用于冲突后告诉用户对方做了什么 */
  expected_status?: ExchangeStatus | ItemStatus;
}

export type CommitEntityKind = 'exchange' | 'item';

/** 批次内的单步写入。provenance 标记本步骤由哪个批次落下，重试时据此跳过已落库的步骤 */
export interface CommitStep {
  index: number;
  entity: CommitEntityKind;
  id: string;
  status: ExchangeStatus | ItemStatus;
  revision: number;
  locked_by_exchange_id?: string | null;
  provenance_batch_id: string;
  applied: boolean;
}

/** 提交前校验出的冲突详情，页面据此列出对方的改动 */
export interface ConflictDetail {
  entity: CommitEntityKind;
  id: string;
  title?: string;
  reason: CommitReason;
  expected_revision: number;
  actual_revision: number;
  expected_status?: ExchangeStatus | ItemStatus;
  actual_status?: ExchangeStatus | ItemStatus;
  related_exchange_id?: string;
}

export interface CommitBatch {
  id: string;
  kind: CommitKind;
  status: CommitBatchStatus;
  created_at: string;
  updated_at: string;
  /** 发起交换时预生成的交换记录 id，保证重试不会重复生成交换记录 */
  draft_exchange_id?: string;
  draft_exchange?: Record<string, unknown>;
  guards: RevisionGuard[];
  steps: CommitStep[];
  conflicts: ConflictDetail[];
  /** 跨标签页互斥锁的持有者标识 */
  locked_by?: string;
  lock_expires_at?: number;
}

export type CommitBatchDraft = Pick<CommitBatch, 'kind' | 'guards' | 'steps'> &
  Partial<Pick<CommitBatch, 'draft_exchange_id' | 'draft_exchange'>>;
