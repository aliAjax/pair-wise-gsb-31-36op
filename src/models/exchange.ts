import { ExchangeStatus } from '@/constants/exchange';

export interface Exchange {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_item_id: string;
  to_item_id: string;
  status: ExchangeStatus;
  message: string;
  /** 乐观锁修订号：确认、拒绝、完成等任何写入都会 +1 */
  revision: number;
  created_at: string;
  updated_at: string;
}

export type ExchangeDraft = Omit<Exchange, 'id' | 'status' | 'revision' | 'created_at' | 'updated_at'> & {
  status?: ExchangeStatus;
  revision?: number;
};
