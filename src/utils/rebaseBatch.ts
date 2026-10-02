import { exchangeApi } from '@/api/exchangeApi';
import { itemApi } from '@/api/itemApi';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { BatchOperation, PendingBatch } from '@/types';
import { exchangeExpectedRefs, exchangeSubmitPayload, itemRevisionRef } from '@/utils/revisionHelpers';

/**
 * 用存储中的最新数据重建批次操作：
 * - 保留用户原本的意图（发起/同意/拒绝/完成/下架）；
 * - 用最新 revision 与状态替换落后页面携带的修订信息。
 * 若目标实体已不存在则返回 null，由上层放弃该批次。
 */
export const rebaseBatchOperation = async (
  operation: BatchOperation,
): Promise<BatchOperation | null> => {
  if (operation.kind === 'create-exchange') {
    const [fromItem, toItem] = await Promise.all([
      itemApi.detail(operation.draft.from_item_id),
      itemApi.detail(operation.draft.to_item_id),
    ]);
    if (!fromItem || !toItem) return null;
    return {
      ...operation,
      refs: exchangeExpectedRefs(fromItem, toItem),
    };
  }

  if (operation.kind === 'item-offline') {
    const item: Item | undefined = await itemApi.detail(operation.id);
    if (!item) return null;
    return {
      ...operation,
      ref: itemRevisionRef(item),
    };
  }

  const exchange: Exchange | undefined = await exchangeApi.detail(operation.id);
  if (!exchange) return null;
  const items: Item[] = [];
  for (const itemId of [exchange.from_item_id, exchange.to_item_id]) {
    const item = await itemApi.detail(itemId);
    if (!item) return null;
    items.push(item);
  }
  return {
    ...operation,
    payload: exchangeSubmitPayload(exchange, items, operation.payload.action),
  };
};

export const rebaseBatch = async (batch: PendingBatch): Promise<PendingBatch | null> => {
  const operation = await rebaseBatchOperation(batch.operation);
  if (!operation) return null;
  return {
    ...batch,
    operation,
    conflict: undefined,
    last_error: undefined,
    state: 'pending',
  };
};
