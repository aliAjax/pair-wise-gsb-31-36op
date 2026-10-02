import { ItemCondition, ItemStatus } from '@/constants/item';

export interface Item {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  images: string[];
  status: ItemStatus;
  /** 乐观锁修订号：任何写入都会 +1，落后页面带上旧号提交会被拒绝 */
  revision: number;
  /** 同意交换后锁定物品用的交换记录 id，完成或拒绝后清空 */
  locked_by_exchange_id?: string;
  location: string;
  created_at: string;
}

export type ItemDraft = Omit<Item, 'id' | 'status' | 'revision' | 'locked_by_exchange_id' | 'created_at'> & {
  status?: ItemStatus;
  revision?: number;
};
