/**
 * 可恢复提交批次相关的常量。
 * 常量被 api/commitApi、stores/commitStore、hooks/useStorageSync、pages/Exchanges 多处引用，
 * 修改动作类型或存储 key 时需要同步这些文件。
 */
export enum CommitKind {
  CREATE_EXCHANGE = 'create_exchange',
  ACCEPT_EXCHANGE = 'accept_exchange',
  REJECT_EXCHANGE = 'reject_exchange',
  COMPLETE_EXCHANGE = 'complete_exchange',
  OFFLINE_ITEM = 'offline_item',
}

export enum CommitBatchStatus {
  PENDING = 'pending',
  COMMITTED = 'committed',
  FAILED_CONFLICT = 'failed_conflict',
}

export enum CommitReason {
  REVISION_STALE = 'revision_stale',
  MISSING = 'missing',
  UNEXPECTED_STATUS = 'unexpected_status',
  ITEM_NOT_AVAILABLE = 'item_not_available',
  DUPLICATE_EXCHANGE = 'duplicate_exchange',
  LOCKED_ELSEWHERE = 'locked_elsewhere',
  ILLEGAL_TRANSITION = 'illegal_transition',
}

export const COMMIT_ACTION_LABELS: Record<CommitKind, string> = {
  [CommitKind.CREATE_EXCHANGE]: '发起交换',
  [CommitKind.ACCEPT_EXCHANGE]: '确认交换',
  [CommitKind.REJECT_EXCHANGE]: '拒绝交换',
  [CommitKind.COMPLETE_EXCHANGE]: '完成交换',
  [CommitKind.OFFLINE_ITEM]: '物品下架',
};

export const COMMIT_STORAGE_HINTS = {
  outboxKey: 'reswap:commit-outbox',
  lockKey: 'reswap:commit-lock',
  touchedBy: [
    'models/commitBatch.ts',
    'api/commitApi.ts',
    'stores/commitStore.ts',
    'hooks/useStorageSync.ts',
    'pages/Exchanges.vue',
  ],
};
