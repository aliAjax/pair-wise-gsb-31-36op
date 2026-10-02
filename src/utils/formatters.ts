import dayjs from 'dayjs';

import { CommitReason } from '@/constants/commit';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { STATUS_MESSAGE_MAP } from '@/constants/messages';
import type { ConflictDetail } from '@/models/commitBatch';

export const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm');

export const formatItemStatus = (status: ItemStatus) => {
  const map: Record<ItemStatus, string> = {
    [ItemStatus.AVAILABLE]: '可交换',
    [ItemStatus.BOOKED]: '交换锁定',
    [ItemStatus.EXCHANGED]: '已交换',
    [ItemStatus.OFFLINE]: '已下架',
  };
  return map[status] ?? String(status ?? '未知');
};

export const formatExchangeStatus = (status: ExchangeStatus) => {
  const map: Record<ExchangeStatus, string> = {
    [ExchangeStatus.PENDING]: '待确认',
    [ExchangeStatus.ACCEPTED]: '已同意',
    [ExchangeStatus.REJECTED]: '已拒绝',
    [ExchangeStatus.COMPLETED]: '已完成',
  };
  return map[status] ?? String(status ?? '未知');
};

export const formatAnyStatus = (status: ItemStatus | ExchangeStatus | undefined) => {
  if (!status) return '未知状态';
  return Object.values(ItemStatus).includes(status as ItemStatus)
    ? formatItemStatus(status as ItemStatus)
    : formatExchangeStatus(status as ExchangeStatus);
};

export const formatCondition = (condition: ItemCondition) => {
  const map: Record<ItemCondition, string> = {
    [ItemCondition.NEW]: '全新',
    [ItemCondition.LIKE_NEW]: '九成新',
    [ItemCondition.GOOD]: '八成新',
    [ItemCondition.WORN]: '战损',
  };
  return map[condition];
};

export const formatCreditLevel = (score: number) => {
  if (score >= 90) return '守约达人';
  if (score >= 75) return '稳定交换';
  if (score >= 60) return '新晋用户';
  return '需谨慎';
};

export const statusToneClass = (status: ItemStatus | ExchangeStatus) => {
  if (status === ItemStatus.AVAILABLE || status === ExchangeStatus.ACCEPTED) return 'status-good';
  if (status === ItemStatus.OFFLINE || status === ExchangeStatus.REJECTED) return 'status-muted';
  if (status === ItemStatus.EXCHANGED || status === ExchangeStatus.COMPLETED) return 'status-done';
  return 'status-wait';
};

export const formatStatusMessage = (status: ItemStatus | ExchangeStatus) => STATUS_MESSAGE_MAP[status];

const CONFLICT_REASON_TEXT: Record<CommitReason, string> = {
  [CommitReason.REVISION_STALE]: '已被另一个页面修改',
  [CommitReason.MISSING]: '记录已不存在',
  [CommitReason.UNEXPECTED_STATUS]: '状态已变化',
  [CommitReason.ITEM_NOT_AVAILABLE]: '物品当前不可交换',
  [CommitReason.DUPLICATE_EXCHANGE]: '这两件物品已有进行中的交换',
  [CommitReason.LOCKED_ELSEWHERE]: '物品已被另一笔交换锁定',
  [CommitReason.ILLEGAL_TRANSITION]: '当前状态不允许该操作',
};

const entityLabel = (conflict: ConflictDetail) => {
  const kindText = conflict.entity === 'exchange' ? '交换' : '物品';
  return conflict.title ? `${kindText} ${conflict.title}` : `${kindText}（${conflict.id}）`;
};

/** 把冲突详情渲染成“对方改动列表”，供旧页面保留输入后提示用户 */
export const formatConflictLine = (conflict: ConflictDetail): string => {
  const reasonText = CONFLICT_REASON_TEXT[conflict.reason] ?? '数据已变化';
  const actual = conflict.actual_status ? `，当前为「${formatAnyStatus(conflict.actual_status)}」` : '';
  return `${entityLabel(conflict)}：${reasonText}${actual}`;
};

export const formatRevisionHint = (conflict: ConflictDetail): string =>
  `修订号 ${conflict.expected_revision} → ${conflict.actual_revision}`;
