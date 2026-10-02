import { ExchangeStatus } from '@/constants/exchange';

import type { ItemRevisionRef } from './item';

export const INITIAL_EXCHANGE_REVISION = 1;

export interface Exchange {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_item_id: string;
  to_item_id: string;
  status: ExchangeStatus;
  message: string;
  created_at: string;
  updated_at: string;
  /** 发起方幂等键：同一批次重试不会重复生成交换记录 */
  request_key?: string;
  /** 乐观锁修订号：每次交换状态流转 +1，提交时必须回传 */
  revision: number;
}

export type ExchangeDraft = Omit<
  Exchange,
  'id' | 'status' | 'created_at' | 'updated_at' | 'revision'
> & {
  status?: ExchangeStatus;
};

/** 交换侧支持的原子动作，对应可恢复批次的操作类型 */
export type ExchangeAction =
  | ExchangeStatus.ACCEPTED
  | ExchangeStatus.REJECTED
  | ExchangeStatus.COMPLETED;

/** 发起交换时随表单携带的两侧物品修订信息 */
export interface ExchangeExpectedRefs {
  fromItem: ItemRevisionRef;
  toItem: ItemRevisionRef;
}

/** 同意/拒绝/完成时携带的交换与两侧物品修订信息 */
export interface ExchangeSubmitPayload {
  action: ExchangeAction;
  exchangeRevision: number;
  items: ItemRevisionRef[];
}
