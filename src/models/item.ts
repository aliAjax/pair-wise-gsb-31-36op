import { ItemCondition, ItemStatus } from '@/constants/item';

export const INITIAL_ITEM_REVISION = 1;

export interface Item {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: string;
  condition: ItemCondition;
  images: string[];
  status: ItemStatus;
  location: string;
  created_at: string;
  updated_at: string;
  /** 乐观锁修订号：每次物品写入 +1，提交时必须回传 */
  revision: number;
}

export type ItemDraft = Omit<Item, 'id' | 'status' | 'created_at' | 'updated_at' | 'revision'> & {
  status?: ItemStatus;
};

/** 提交一次物品写入时所依据的修订信息 */
export interface ItemRevisionRef {
  id: string;
  revision: number;
  status: ItemStatus;
}
