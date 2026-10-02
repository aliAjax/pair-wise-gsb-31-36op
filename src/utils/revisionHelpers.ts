import { ItemStatus } from '@/constants/item';
import type { Exchange, ExchangeExpectedRefs, ExchangeSubmitPayload } from '@/models/exchange';
import type { Item, ItemRevisionRef } from '@/models/item';
import type {
  CreateExchangeOperation,
  ItemOfflineOperation,
  RemoteChange,
  RevisionMismatchDetail,
  TransitionExchangeOperation,
} from '@/types';

export const itemRevisionRef = (item: Pick<Item, 'id' | 'revision' | 'status'>): ItemRevisionRef => ({
  id: item.id,
  revision: item.revision,
  status: item.status,
});

export const exchangeExpectedRefs = (
  fromItem: Pick<Item, 'id' | 'revision' | 'status'>,
  toItem: Pick<Item, 'id' | 'revision' | 'status'>,
): ExchangeExpectedRefs => ({
  fromItem: itemRevisionRef(fromItem),
  toItem: itemRevisionRef(toItem),
});

export const exchangeSubmitPayload = (
  exchange: Pick<Exchange, 'revision'>,
  items: Array<Pick<Item, 'id' | 'revision' | 'status'>>,
  action: ExchangeSubmitPayload['action'],
): ExchangeSubmitPayload => ({
  action,
  exchangeRevision: exchange.revision,
  items: items.map(itemRevisionRef),
});

export const createExchangeOperation = (
  draft: CreateExchangeOperation['draft'],
  refs: ExchangeExpectedRefs,
): CreateExchangeOperation => ({
  kind: 'create-exchange',
  key: `exchange_req_${crypto.randomUUID?.() ?? `${Date.now()}_${Math.random().toString(16).slice(2)}`}`,
  draft,
  refs,
});

export const transitionExchangeOperation = (
  id: string,
  payload: ExchangeSubmitPayload,
): TransitionExchangeOperation => ({
  kind: 'transition-exchange',
  id,
  payload,
});

export const itemOfflineOperation = (item: Pick<Item, 'id' | 'revision' | 'status'>): ItemOfflineOperation => ({
  kind: 'item-offline',
  id: item.id,
  ref: itemRevisionRef(item),
});

export const remoteChangeFromItem = (
  ref: ItemRevisionRef,
  current: Item,
): { detail: RevisionMismatchDetail; change: RemoteChange } => ({
  detail: {
    kind: 'item',
    id: current.id,
    expected: ref.revision,
    actual: current.revision,
    expectedStatus: ref.status,
    actualStatus: current.status,
    title: current.title,
  },
  change: {
    kind: 'item',
    id: current.id,
    title: current.title,
    fromStatus: ref.status,
    toStatus: current.status,
    changedAt: current.updated_at,
  },
});

/** 已换出/已下架的物品不允许再被选为交换物或被覆盖回去 */
export const isItemLocked = (status: ItemStatus) => status !== ItemStatus.AVAILABLE;
