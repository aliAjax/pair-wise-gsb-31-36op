import dayjs from 'dayjs';

import { ExchangeStatus } from '@/constants/exchange';
import { ItemCondition, ItemStatus } from '@/constants/item';
import { STATUS_MESSAGE_MAP } from '@/constants/messages';
import type { RemoteChange } from '@/types';

export const formatDate = (date: string) => dayjs(date).format('YYYY-MM-DD HH:mm');

export const formatItemStatus = (status: ItemStatus) => {
  const map: Record<ItemStatus, string> = {
    [ItemStatus.AVAILABLE]: '可交换',
    [ItemStatus.EXCHANGED]: '已交换',
    [ItemStatus.OFFLINE]: '已下架',
  };
  return map[status];
};

export const formatExchangeStatus = (status: ExchangeStatus) => {
  const map: Record<ExchangeStatus, string> = {
    [ExchangeStatus.PENDING]: '待确认',
    [ExchangeStatus.ACCEPTED]: '已同意',
    [ExchangeStatus.REJECTED]: '已拒绝',
    [ExchangeStatus.COMPLETED]: '已完成',
  };
  return map[status];
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

const resolveStatusLabel = (status: string): string => {
  if ((Object.values(ItemStatus) as string[]).includes(status)) {
    return formatItemStatus(status as ItemStatus);
  }
  if ((Object.values(ExchangeStatus) as string[]).includes(status)) {
    return formatExchangeStatus(status as ExchangeStatus);
  }
  return status || '未知状态';
};

/** 把"对方改动"渲染成：物品名 已由 可交换 改为 已交换（时间） */
export const formatRemoteChange = (change: RemoteChange): string => {
  const subject = change.kind === 'exchange' ? '交换请求' : change.title ?? '物品';
  const from = resolveStatusLabel(change.fromStatus);
  const to = resolveStatusLabel(change.toStatus);
  const time = formatDate(change.changedAt);
  return `${subject} 已由「${from}」改为「${to}」（${time}）`;
};

/** 落后页面提交被拒后，提示当前有效版本的修订号 */
export const formatRevisionHint = (expected: number, actual: number): string =>
  `页面版本 r${expected} 已落后，当前有效版本 r${actual}`;
