import { ItemCondition, ItemStatus } from '@/constants/item';
import type { Item, ItemDraft, ItemRevisionRef } from '@/models/item';
import { INITIAL_ITEM_REVISION } from '@/models/item';
import type { RemoteChange, RevisionMismatchDetail } from '@/types';
import { isItemLocked, remoteChangeFromItem } from '@/utils/revisionHelpers';
import { RevisionMismatchError } from '@/utils/revision';

import { storage, STORAGE_KEYS } from '@/utils/storage';

const now = new Date().toISOString();

const seedItems: Item[] = [
  {
    id: 'item_camera',
    user_id: 'user_lin',
    title: '富士拍立得 Mini 旧机',
    description: '成色干净，附一包相纸，想换小型蓝牙音箱或桌面灯。',
    category: '数码',
    condition: ItemCondition.GOOD,
    images: [],
    status: ItemStatus.AVAILABLE,
    location: '杭州 · 西湖',
    created_at: now,
    updated_at: now,
    revision: INITIAL_ITEM_REVISION,
  },
  {
    id: 'item_books',
    user_id: 'user_chen',
    title: '设计与产品书 6 本',
    description: '搬家清书柜，适合产品/视觉入门，接受换绿植、咖啡器具。',
    category: '书籍',
    condition: ItemCondition.LIKE_NEW,
    images: [],
    status: ItemStatus.AVAILABLE,
    location: '苏州 · 工业园',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    revision: INITIAL_ITEM_REVISION,
  },
  {
    id: 'item_chair',
    user_id: 'user_me',
    title: '可折叠露营椅',
    description: '去年买的，露营两次，有轻微使用痕迹，想换收纳盒。',
    category: '运动',
    condition: ItemCondition.GOOD,
    images: [],
    status: ItemStatus.AVAILABLE,
    location: '上海 · 徐汇',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
    revision: INITIAL_ITEM_REVISION,
  },
  {
    id: 'item_lamp',
    user_id: 'user_lin',
    title: '木质小夜灯',
    description: '暖光，适合床头。已完成交换，保留记录用于状态展示。',
    category: '家居',
    condition: ItemCondition.LIKE_NEW,
    images: [],
    status: ItemStatus.EXCHANGED,
    location: '杭州 · 西湖',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 90).toISOString(),
    updated_at: new Date(Date.now() - 1000 * 60 * 60 * 90).toISOString(),
    revision: INITIAL_ITEM_REVISION,
  },
];

export const itemApi = {
  async list(): Promise<Item[]> {
    if (await storage.has(STORAGE_KEYS.items)) {
      return storage.get<Item[]>(STORAGE_KEYS.items, []);
    }
    await storage.set(STORAGE_KEYS.items, seedItems);
    return seedItems;
  },

  async detail(id: string): Promise<Item | undefined> {
    const items = await this.list();
    return items.find((item) => item.id === id);
  },

  async create(draft: ItemDraft): Promise<Item> {
    const items = await this.list();
    const timestamp = new Date().toISOString();
    const nextItem: Item = {
      ...draft,
      id: storage.createId('item'),
      status: draft.status ?? ItemStatus.AVAILABLE,
      created_at: timestamp,
      updated_at: timestamp,
      revision: INITIAL_ITEM_REVISION,
    };
    await storage.set(STORAGE_KEYS.items, [nextItem, ...items]);
    return nextItem;
  },

  async update(id: string, patch: Partial<Item>): Promise<Item> {
    const items = await this.list();
    const current = items.find((item) => item.id === id);
    if (!current) throw new Error('物品不存在');
    const nextItem: Item = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
      revision: current.revision + 1,
    };
    await storage.set(
      STORAGE_KEYS.items,
      items.map((item) => (item.id === id ? nextItem : item)),
    );
    return nextItem;
  },

  /**
   * 带修订信息的条件写入：只有 ref.revision 与当前物品一致才落库。
   * 落后页面提交时抛 RevisionMismatchError，由上层保留输入并列出对方改动。
   * status 未变化时保持幂等（直接返回当前物品），保证重试安全。
   */
  async commitStatus(ref: ItemRevisionRef): Promise<Item> {
    const items = await this.list();
    const current = items.find((item) => item.id === ref.id);
    if (!current) throw new Error('物品不存在');
    if (current.revision !== ref.revision) {
      const { detail, change } = remoteChangeFromItem(ref, current);
      throw new RevisionMismatchError('物品已被其他页面修改，请刷新后重试', [detail], [change]);
    }
    if (current.status === ref.status) {
      // 已是目标状态：若仍有其它写入意图这里不再推进，保持幂等
      return current;
    }
    return this.update(ref.id, { status: ref.status });
  },

  /**
   * 供交换批次调用：期望把物品改成 expectedStatus。
   * 若该物品已被锁定（已交换/已下架），同样视为冲突，避免盖回。
   */
  async commitForExchange(ref: ItemRevisionRef, expectedStatus: ItemStatus): Promise<Item> {
    const current = await this.detail(ref.id);
    if (!current) throw new Error('物品不存在');
    if (current.revision === ref.revision && current.status === expectedStatus) {
      return current;
    }
    if (current.revision !== ref.revision || isItemLocked(current.status)) {
      const { detail, change } = remoteChangeFromItem(ref, current);
      throw new RevisionMismatchError('物品已被其他页面修改，请基于最新数据重试', [detail], [change]);
    }
    return this.update(ref.id, { status: expectedStatus });
  },

  /**
   * 批量条件写入（完成交换时两侧物品一起落库）：
   * 先一次性校验全部修订信息与可交换状态，再通过一次整表写入同时更新，
   * 保证两件物品要么一起成功，要么一件都不改，不产生半成品。
   */
  async commitStatusesForExchange(
    refs: ItemRevisionRef[],
    expectedStatus: ItemStatus,
  ): Promise<Item[]> {
    const items = await this.list();
    const details: RevisionMismatchDetail[] = [];
    const changes: RemoteChange[] = [];
    const nextItems = items.map((current) => {
      const ref = refs.find((entry) => entry.id === current.id);
      if (!ref) return current;
      const revisionMismatch = current.revision !== ref.revision;
      const locked = isItemLocked(current.status) && current.status !== expectedStatus;
      if (revisionMismatch || locked) {
        const { detail, change } = remoteChangeFromItem(ref, current);
        details.push(detail);
        changes.push(change);
        return current;
      }
      if (current.status === expectedStatus) return current;
      const next: Item = {
        ...current,
        status: expectedStatus,
        updated_at: new Date().toISOString(),
        revision: current.revision + 1,
      };
      return next;
    });

    if (details.length) {
      throw new RevisionMismatchError('关联物品已被其他页面修改，请基于最新数据重做', details, changes);
    }
    const changed = nextItems.some((item, index) => item !== items[index]);
    if (changed) {
      await storage.set(STORAGE_KEYS.items, nextItems);
    }
    return refs
      .map((ref) => nextItems.find((item) => item.id === ref.id))
      .filter((item): item is Item => Boolean(item));
  },

  async setStatus(id: string, status: ItemStatus): Promise<Item> {
    return this.update(id, { status });
  },
};
