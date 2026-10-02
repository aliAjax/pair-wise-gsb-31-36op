import { exchangeApi } from '@/api/exchangeApi';
import { itemApi } from '@/api/itemApi';
import { ItemStatus } from '@/constants/item';
import type { BatchOperation } from '@/types';

/**
 * 执行单个批次操作。
 * - create-exchange：幂等发起，重试不重复生成交换记录；
 * - transition-exchange：交换与两侧物品一起成功或一起失败；
 * - item-offline：携带修订信息下架，落后页面无法盖回新结果。
 * 任何修订冲突（RevisionMismatchError）会原样向上抛出，由批次层保留可重试记录。
 */
export const runBatchOperation = (operation: BatchOperation) => {
  if (operation.kind === 'create-exchange') {
    return exchangeApi.create(operation.draft, operation.refs, operation.key);
  }
  if (operation.kind === 'transition-exchange') {
    return exchangeApi.transition(operation.id, operation.payload);
  }
  return itemApi.commitForExchange(operation.ref, ItemStatus.OFFLINE);
};
