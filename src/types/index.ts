import type { ExchangeStatus } from '@/constants/exchange';
import type { ItemCondition, ItemStatus } from '@/constants/item';
import type { ExchangeDraft, ExchangeExpectedRefs, ExchangeSubmitPayload } from '@/models/exchange';
import type { ItemRevisionRef } from '@/models/item';

export interface Option<T extends string> {
  label: string;
  value: T;
}

export interface PersistedEnvelope<T> {
  version: number;
  expiresAt?: number;
  payload: T;
}

export interface StatusFilter {
  item?: ItemStatus;
  exchange?: ExchangeStatus;
  condition?: ItemCondition;
}

export interface ImageFilePayload {
  id: string;
  name: string;
  dataUrl: string;
}

/** 单个实体的修订冲突：页面依据的 revision 与存储中的 revision 不一致 */
export interface RevisionMismatchDetail {
  kind: 'exchange' | 'item';
  id: string;
  expected: number;
  actual: number;
  expectedStatus: string;
  actualStatus: string;
  title?: string;
}

/** 对方（或另一标签页）已经写入的改动，用于在页面上列给用户看 */
export interface RemoteChange {
  kind: 'exchange' | 'item';
  id: string;
  title?: string;
  fromStatus: string;
  toStatus: string;
  changedAt: string;
}

/** 发起交换：携带幂等键，失败重试不会重复生成交换记录 */
export interface CreateExchangeOperation {
  kind: 'create-exchange';
  key: string;
  draft: ExchangeDraft;
  refs: ExchangeExpectedRefs;
}

/** 同意 / 拒绝 / 完成交换：携带交换与两侧物品的修订信息 */
export interface TransitionExchangeOperation {
  kind: 'transition-exchange';
  id: string;
  payload: ExchangeSubmitPayload;
}

/** 物品下架：携带物品自身的修订信息 */
export interface ItemOfflineOperation {
  kind: 'item-offline';
  id: string;
  ref: ItemRevisionRef;
}

export type BatchOperation = CreateExchangeOperation | TransitionExchangeOperation | ItemOfflineOperation;

export type BatchState = 'pending' | 'conflict';

export interface PendingConflict {
  at: string;
  details: RevisionMismatchDetail[];
  changes: RemoteChange[];
}

/** 失败后留下的可重试批次 */
export interface PendingBatch {
  id: string;
  created_at: string;
  attempts: number;
  state: BatchState;
  last_error?: string;
  conflict?: PendingConflict;
  operation: BatchOperation;
}
