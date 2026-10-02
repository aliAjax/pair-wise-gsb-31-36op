import { EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type {
  Exchange,
  ExchangeDraft,
  ExchangeExpectedRefs,
  ExchangeSubmitPayload,
} from '@/models/exchange';
import { INITIAL_EXCHANGE_REVISION } from '@/models/exchange';
import { RevisionMismatchError } from '@/utils/revision';
import { isItemLocked } from '@/utils/revisionHelpers';

import { itemApi } from './itemApi';
import { storage, STORAGE_KEYS } from '@/utils/storage';

const seedTimestamp = new Date(Date.now() - 1000 * 60 * 60).toISOString();

const seedExchanges: Exchange[] = [
  {
    id: 'exchange_seed',
    from_user_id: 'user_me',
    to_user_id: 'user_lin',
    from_item_id: 'item_chair',
    to_item_id: 'item_camera',
    status: ExchangeStatus.PENDING,
    message: '露营椅换拍立得，可以同城当面交换。',
    created_at: seedTimestamp,
    updated_at: seedTimestamp,
    revision: INITIAL_EXCHANGE_REVISION,
  },
];

const exchangeConflict = (
  current: Exchange,
  expected: number,
): RevisionMismatchError =>
  new RevisionMismatchError(
    '交换状态已被另一个页面更新，请确认对方改动后重做',
    [
      {
        kind: 'exchange',
        id: current.id,
        expected,
        actual: current.revision,
        expectedStatus: '',
        actualStatus: current.status,
      },
    ],
    [
      {
        kind: 'exchange',
        id: current.id,
        fromStatus: '',
        toStatus: current.status,
        changedAt: current.updated_at,
      },
    ],
  );

export const exchangeApi = {
  async list(): Promise<Exchange[]> {
    if (await storage.has(STORAGE_KEYS.exchanges)) {
      return storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []);
    }
    await storage.set(STORAGE_KEYS.exchanges, seedExchanges);
    return seedExchanges;
  },

  async detail(id: string): Promise<Exchange | undefined> {
    const exchanges = await this.list();
    return exchanges.find((item) => item.id === id);
  },

  /**
   * 幂等发起：同一 requestKey 重试直接返回已存在的交换，不重复生成记录。
   * 发起时校验两侧物品的修订与状态，任一落后或已锁定都抛冲突。
   */
  async create(
    draft: ExchangeDraft,
    refs: ExchangeExpectedRefs,
    requestKey: string,
  ): Promise<Exchange> {
    const exchanges = await this.list();
    const existing = exchanges.find((item) => item.request_key === requestKey);
    if (existing) return existing;

    const targetItem = await itemApi.detail(draft.to_item_id);
    if (!targetItem) throw new Error('目标物品不存在');

    const ownItem = await itemApi.detail(draft.from_item_id);
    if (!ownItem) throw new Error('我的交换物不存在');

    const errors: RevisionMismatchError[] = [];
    [
      { ref: refs.fromItem, current: ownItem },
      { ref: refs.toItem, current: targetItem },
    ].forEach(({ ref, current }) => {
      if (current.revision !== ref.revision || isItemLocked(current.status)) {
        const conflict = new RevisionMismatchError(
          '物品已被其他页面修改，请基于最新数据重试',
          [
            {
              kind: 'item',
              id: current.id,
              expected: ref.revision,
              actual: current.revision,
              expectedStatus: ref.status,
              actualStatus: current.status,
              title: current.title,
            },
          ],
          [
            {
              kind: 'item',
              id: current.id,
              title: current.title,
              fromStatus: ref.status,
              toStatus: current.status,
              changedAt: current.updated_at,
            },
          ],
        );
        errors.push(conflict);
      }
    });
    if (errors.length) {
      const merged = errors.reduce(
        (acc, error) => {
          acc.details.push(...error.details);
          acc.changes.push(...error.changes);
          return acc;
        },
        { details: [], changes: [] } as {
          details: RevisionMismatchError['details'];
          changes: RevisionMismatchError['changes'];
        },
      );
      throw new RevisionMismatchError(
        '物品已被其他页面修改，请基于最新数据重试',
        merged.details,
        merged.changes,
      );
    }

    const timestamp = new Date().toISOString();
    const nextExchange: Exchange = {
      ...draft,
      id: storage.createId('exchange'),
      status: draft.status ?? ExchangeStatus.PENDING,
      created_at: timestamp,
      updated_at: timestamp,
      request_key: requestKey,
      revision: INITIAL_EXCHANGE_REVISION,
    };
    await storage.set(STORAGE_KEYS.exchanges, [nextExchange, ...exchanges]);
    return nextExchange;
  },

  /**
   * 带修订信息的状态流转。
   * exchangeRevision 与两侧物品 revision 全部匹配才提交。
   * 完成交换时两侧物品在一次校验 + 一次整表写入中一起落库，
   * 随后才写交换状态；任何一项落后都整体失败并留下可重试批次。
   */
  async transition(id: string, payload: ExchangeSubmitPayload): Promise<Exchange> {
    const exchanges = await this.list();
    const current = exchanges.find((item) => item.id === id);
    if (!current) throw new Error('交换请求不存在');

    // 幂等：同一动作的重试，若交换已经是目标状态，直接返回当前记录
    if (current.status === payload.action && current.revision >= payload.exchangeRevision) {
      return current;
    }

    if (current.revision !== payload.exchangeRevision) {
      throw exchangeConflict(current, payload.exchangeRevision);
    }
    if (!EXCHANGE_ACTION_FLOW[current.status].includes(payload.action)) {
      throw new Error('当前状态不允许该操作');
    }

    // 校验两侧物品修订信息是否齐备（不写入）；完成时还要求两侧仍可交换
    const involvedItemIds = [current.from_item_id, current.to_item_id];
    const refs = involvedItemIds.map((itemId) => {
      const ref = payload.items.find((item) => item.id === itemId);
      if (!ref) throw new Error('缺少物品修订信息');
      return ref;
    });

    // 批量条件写入：全部修订匹配才一次写完两件物品，否则抛冲突、不产生半成品
    if (payload.action === ExchangeStatus.COMPLETED) {
      await itemApi.commitStatusesForExchange(refs, ItemStatus.EXCHANGED);
    } else {
      // 同意/拒绝：两侧物品自页面读取后若已被改动，整体判定为落后
      const items = await itemApi.list();
      refs.forEach((ref) => {
        const item = items.find((entry) => entry.id === ref.id);
        if (!item) throw new Error('物品不存在');
        if (item.revision !== ref.revision) {
          throw new RevisionMismatchError(
            '关联物品已被其他页面修改，请基于最新数据重做',
            [
              {
                kind: 'item',
                id: item.id,
                expected: ref.revision,
                actual: item.revision,
                expectedStatus: ref.status,
                actualStatus: item.status,
                title: item.title,
              },
            ],
            [
              {
                kind: 'item',
                id: item.id,
                title: item.title,
                fromStatus: ref.status,
                toStatus: item.status,
                changedAt: item.updated_at,
              },
            ],
          );
        }
      });
    }

    const nextExchange: Exchange = {
      ...current,
      status: payload.action,
      updated_at: new Date().toISOString(),
      revision: current.revision + 1,
    };
    await storage.set(
      STORAGE_KEYS.exchanges,
      exchanges.map((item) => (item.id === id ? nextExchange : item)),
    );
    return nextExchange;
  },
};
