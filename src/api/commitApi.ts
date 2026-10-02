import { CommitBatchStatus, CommitKind, CommitReason } from '@/constants/commit';
import { EXCHANGE_ACTION_FLOW, ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import type { CommitBatch, CommitBatchDraft, CommitStep, ConflictDetail } from '@/models/commitBatch';
import type { Exchange, ExchangeDraft } from '@/models/exchange';
import type { Item } from '@/models/item';
import { CommitConflictError } from '@/utils/commitError';
import { storage, STORAGE_KEYS } from '@/utils/storage';

/** 页面侧动作携带的修订信息，全部来自最新一次 hydrate 的数据 */
export interface CreateExchangeRequest extends ExchangeDraft {
  expected_from_item_revision: number;
  expected_to_item_revision: number;
}

export interface ExchangeTransitionRequest {
  exchangeId: string;
  expectedExchangeRevision: number;
  expectedFromItemRevision: number;
  expectedToItemRevision: number;
}

export interface OfflineItemRequest {
  itemId: string;
  expectedItemRevision: number;
  /** 页面上所有引用该物品的待确认交换及其修订号，下架时一并拒绝 */
  pendingExchanges: Array<{ id: string; revision: number }>;
}

interface Snapshot {
  exchanges: Exchange[];
  items: Item[];
}

const LOCK_TTL = 8000;
const LOCK_WAIT_MS = 3000;

const exchangeTitle = (exchange: Exchange | undefined, items: Item[]) => {
  if (!exchange) return '交换请求';
  const from = items.find((item) => item.id === exchange.from_item_id)?.title ?? '未知物品';
  const to = items.find((item) => item.id === exchange.to_item_id)?.title ?? '未知物品';
  return `“${from}”换“${to}”`;
};

const readSnapshot = async (): Promise<Snapshot> => ({
  exchanges: await storage.get<Exchange[]>(STORAGE_KEYS.exchanges, []),
  items: await storage.get<Item[]>(STORAGE_KEYS.items, []),
});

const writeExchanges = (exchanges: Exchange[]) => storage.set(STORAGE_KEYS.exchanges, exchanges);
const writeItems = (items: Item[]) => storage.set(STORAGE_KEYS.items, items);

const getOutbox = () => storage.get<CommitBatch[]>(STORAGE_KEYS.commitOutbox, []);
const setOutbox = (batches: CommitBatch[]) => storage.set(STORAGE_KEYS.commitOutbox, batches);

/* ---------------------------------- 锁 ---------------------------------- */

interface LockPayload {
  owner: string;
  expiresAt: number;
}

let lockOwner = '';
let chain: Promise<unknown> = Promise.resolve();

const withSameTabQueue = <T>(task: () => Promise<T>): Promise<T> => {
  const run = chain.then(task, task);
  chain = run.catch(() => undefined);
  return run;
};

const readLock = async (): Promise<LockPayload | null> =>
  (await storage.getRawLocal<LockPayload>(STORAGE_KEYS.commitLock)) ?? null;

const acquireLock = async (): Promise<void> => {
  const owner = storage.createId('tab');
  lockOwner = owner;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    const current = await readLock();
    if (!current || current.expiresAt < Date.now() || current.owner === owner) {
      const payload: LockPayload = { owner, expiresAt: Date.now() + LOCK_TTL };
      await storage.setRaw(STORAGE_KEYS.commitLock, payload);
      return;
    }
    if (Date.now() > deadline) {
      // 锁长期被异常标签页占用：按 TTL 抢占，后续 CAS 前置条件仍会兜底
      const payload: LockPayload = { owner, expiresAt: Date.now() + LOCK_TTL };
      await storage.setRaw(STORAGE_KEYS.commitLock, payload);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
};

const releaseLock = async (): Promise<void> => {
  const current = await readLock();
  if (current?.owner === lockOwner) {
    await storage.remove(STORAGE_KEYS.commitLock);
  }
};

/* ------------------------------- 批次构造 -------------------------------- */

const toBatch = (draft: CommitBatchDraft): CommitBatch => {
  const timestamp = new Date().toISOString();
  return {
    id: storage.createId('batch'),
    status: CommitBatchStatus.PENDING,
    created_at: timestamp,
    updated_at: timestamp,
    conflicts: [],
    ...draft,
  };
};

const buildCreateBatch = (snapshot: Snapshot, request: CreateExchangeRequest): CommitBatch => {
  const exchangeId = storage.createId('exchange');
  const step: CommitStep = {
    index: 0,
    entity: 'exchange',
    id: exchangeId,
    status: ExchangeStatus.PENDING,
    revision: 1,
    provenance_batch_id: '',
    applied: false,
  };
  const batch = toBatch({
    kind: CommitKind.CREATE_EXCHANGE,
    draft_exchange_id: exchangeId,
    draft_exchange: { ...request },
    guards: [
      {
        kind: 'item',
        id: request.from_item_id,
        revision: request.expected_from_item_revision,
        expected_status: ItemStatus.AVAILABLE,
      },
      {
        kind: 'item',
        id: request.to_item_id,
        revision: request.expected_to_item_revision,
        expected_status: ItemStatus.AVAILABLE,
      },
    ],
    steps: [],
  });
  step.provenance_batch_id = batch.id;
  batch.steps = [step];
  return batch;
};

const buildTransitionBatch = (
  snapshot: Snapshot,
  kind: CommitKind.ACCEPT_EXCHANGE | CommitKind.REJECT_EXCHANGE | CommitKind.COMPLETE_EXCHANGE,
  request: ExchangeTransitionRequest,
): CommitBatch => {
  const exchange = snapshot.exchanges.find((entry) => entry.id === request.exchangeId);
  const targetStatus =
    kind === CommitKind.ACCEPT_EXCHANGE
      ? ExchangeStatus.ACCEPTED
      : kind === CommitKind.REJECT_EXCHANGE
        ? ExchangeStatus.REJECTED
        : ExchangeStatus.COMPLETED;
  const itemTargetStatus =
    kind === CommitKind.ACCEPT_EXCHANGE ? ItemStatus.BOOKED : ItemStatus.EXCHANGED;

  const batch = toBatch({
    kind,
    guards: exchange
      ? [
          {
            kind: 'exchange',
            id: exchange.id,
            revision: request.expectedExchangeRevision,
            expected_status:
              kind === CommitKind.COMPLETE_EXCHANGE
                ? ExchangeStatus.ACCEPTED
                : ExchangeStatus.PENDING,
          },
          {
            kind: 'item',
            id: exchange.from_item_id,
            revision: request.expectedFromItemRevision,
            expected_status:
              kind === CommitKind.COMPLETE_EXCHANGE ? ItemStatus.BOOKED : ItemStatus.AVAILABLE,
          },
          {
            kind: 'item',
            id: exchange.to_item_id,
            revision: request.expectedToItemRevision,
            expected_status:
              kind === CommitKind.COMPLETE_EXCHANGE ? ItemStatus.BOOKED : ItemStatus.AVAILABLE,
          },
        ]
      : [],
    steps: [],
  });

  const steps: CommitStep[] = [];
  if (exchange) {
    steps.push({
      index: 0,
      entity: 'exchange',
      id: exchange.id,
      status: targetStatus,
      revision: exchange.revision + 1,
      provenance_batch_id: batch.id,
      applied: false,
    });
    if (kind !== CommitKind.REJECT_EXCHANGE) {
      [exchange.from_item_id, exchange.to_item_id].forEach((itemId, offset) => {
        const item = snapshot.items.find((entry) => entry.id === itemId);
        steps.push({
          index: offset + 1,
          entity: 'item',
          id: itemId,
          status: itemTargetStatus,
          revision: (item?.revision ?? 0) + 1,
          locked_by_exchange_id:
            kind === CommitKind.ACCEPT_EXCHANGE ? exchange.id : null,
          provenance_batch_id: batch.id,
          applied: false,
        });
      });
    }
  }
  batch.steps = steps;
  return batch;
};

const buildOfflineBatch = (request: OfflineItemRequest): CommitBatch => {
  const batch = toBatch({
    kind: CommitKind.OFFLINE_ITEM,
    guards: [
      {
        kind: 'item',
        id: request.itemId,
        revision: request.expectedItemRevision,
        expected_status: ItemStatus.AVAILABLE,
      },
      ...request.pendingExchanges.map((entry) => ({
        kind: 'exchange' as const,
        id: entry.id,
        revision: entry.revision,
        expected_status: ExchangeStatus.PENDING as ExchangeStatus,
      })),
    ],
    steps: [],
  });
  const steps: CommitStep[] = [
    {
      index: 0,
      entity: 'item',
      id: request.itemId,
      status: ItemStatus.OFFLINE,
      revision: request.expectedItemRevision + 1,
      provenance_batch_id: batch.id,
      applied: false,
    },
  ];
  request.pendingExchanges.forEach((entry, offset) => {
    steps.push({
      index: offset + 1,
      entity: 'exchange',
      id: entry.id,
      status: ExchangeStatus.REJECTED,
      revision: entry.revision + 1,
      provenance_batch_id: batch.id,
      applied: false,
    });
  });
  batch.steps = steps;
  return batch;
};

/* ------------------------------ 守卫校验 -------------------------------- */

const conflict = (
  detail: Omit<ConflictDetail, 'expected_revision' | 'actual_revision'> &
    Partial<Pick<ConflictDetail, 'expected_revision' | 'actual_revision'>>,
  expectedRevision = 0,
  actualRevision = 0,
): ConflictDetail => ({
  expected_revision: expectedRevision,
  actual_revision: actualRevision,
  ...detail,
});

const validateGuards = (batch: CommitBatch, snapshot: Snapshot): ConflictDetail[] => {
  const conflicts: ConflictDetail[] = [];

  for (const guard of batch.guards) {
    if (guard.kind === 'exchange') {
      const current = snapshot.exchanges.find((entry) => entry.id === guard.id);
      if (!current) {
        conflicts.push(
          conflict(
            {
              entity: 'exchange',
              id: guard.id,
              reason: CommitReason.MISSING,
              expected_status: guard.expected_status as ExchangeStatus,
            },
            guard.revision,
            0,
          ),
        );
        continue;
      }
      if (current.revision !== guard.revision) {
        conflicts.push(
          conflict(
            {
              entity: 'exchange',
              id: current.id,
              title: exchangeTitle(current, snapshot.items),
              reason: CommitReason.REVISION_STALE,
              expected_status: guard.expected_status as ExchangeStatus,
              actual_status: current.status,
            },
            guard.revision,
            current.revision,
          ),
        );
        continue;
      }
      if (guard.expected_status && current.status !== guard.expected_status) {
        conflicts.push(
          conflict(
            {
              entity: 'exchange',
              id: current.id,
              title: exchangeTitle(current, snapshot.items),
              reason: CommitReason.UNEXPECTED_STATUS,
              expected_status: guard.expected_status as ExchangeStatus,
              actual_status: current.status,
            },
            guard.revision,
            current.revision,
          ),
        );
      }
      continue;
    }

    const currentItem = snapshot.items.find((entry) => entry.id === guard.id);
    if (!currentItem) {
      conflicts.push(
        conflict(
          { entity: 'item', id: guard.id, reason: CommitReason.MISSING },
          guard.revision,
          0,
        ),
      );
      continue;
    }
    if (currentItem.revision !== guard.revision) {
      conflicts.push(
        conflict(
          {
            entity: 'item',
            id: currentItem.id,
            title: currentItem.title,
            reason: CommitReason.REVISION_STALE,
            expected_status: guard.expected_status as ItemStatus,
            actual_status: currentItem.status,
          },
          guard.revision,
          currentItem.revision,
        ),
      );
      continue;
    }
    if (guard.expected_status && currentItem.status !== guard.expected_status) {
      const lockedElsewhere =
        currentItem.status === ItemStatus.BOOKED &&
        currentItem.locked_by_exchange_id &&
        currentItem.locked_by_exchange_id !== findBatchExchangeId(batch);
      conflicts.push(
        conflict(
          {
            entity: 'item',
            id: currentItem.id,
            title: currentItem.title,
            reason: lockedElsewhere ? CommitReason.LOCKED_ELSEWHERE : CommitReason.UNEXPECTED_STATUS,
            expected_status: guard.expected_status as ItemStatus,
            actual_status: currentItem.status,
            related_exchange_id: currentItem.locked_by_exchange_id,
          },
          guard.revision,
          currentItem.revision,
        ),
      );
    }
  }

  // 发起交换的额外业务校验：两侧物品可交换、同一对物品没有进行中的交换
  if (batch.kind === CommitKind.CREATE_EXCHANGE && batch.draft_exchange) {
    const draft = batch.draft_exchange as unknown as CreateExchangeRequest;
    [draft.from_item_id, draft.to_item_id].forEach((itemId) => {
      const item = snapshot.items.find((entry) => entry.id === itemId);
      if (item && item.status !== ItemStatus.AVAILABLE && !conflicts.some((c) => c.id === item.id)) {
        conflicts.push(
          conflict({
            entity: 'item',
            id: item.id,
            title: item.title,
            reason: CommitReason.ITEM_NOT_AVAILABLE,
            actual_status: item.status,
            actual_revision: item.revision,
            expected_revision:
              itemId === draft.from_item_id
                ? draft.expected_from_item_revision
                : draft.expected_to_item_revision,
          }),
        );
      }
    });
    const duplicated = snapshot.exchanges.find(
      (entry) =>
        [ExchangeStatus.PENDING, ExchangeStatus.ACCEPTED].includes(entry.status) &&
        ((entry.from_item_id === draft.from_item_id && entry.to_item_id === draft.to_item_id) ||
          (entry.from_item_id === draft.to_item_id && entry.to_item_id === draft.from_item_id)),
    );
    if (duplicated) {
      conflicts.push(
        conflict({
          entity: 'exchange',
          id: duplicated.id,
          title: exchangeTitle(duplicated, snapshot.items),
          reason: CommitReason.DUPLICATE_EXCHANGE,
          actual_status: duplicated.status,
          actual_revision: duplicated.revision,
          expected_revision: 0,
        }),
      );
    }
  }

  return conflicts;
};

const findBatchExchangeId = (batch: CommitBatch): string | undefined =>
  batch.draft_exchange_id ??
  batch.steps.find((step) => step.entity === 'exchange')?.id ??
  batch.guards.find((guard) => guard.kind === 'exchange')?.id;

/* --------------------------- 幂等落库（可恢复） --------------------------- */

class ApplyConflictError extends Error {
  conflicts: ConflictDetail[];

  constructor(conflicts: ConflictDetail[]) {
    super('提交中断，数据状态与批次不一致');
    this.name = 'ApplyConflictError';
    this.conflicts = conflicts;
  }
}

const applyExchangeStepSync = (
  step: CommitStep,
  snapshot: Snapshot,
): { exchanges: Exchange[]; applied: boolean } => {
  const target = step.status as ExchangeStatus;
  const index = snapshot.exchanges.findIndex((entry) => entry.id === step.id);

  if (index === -1) {
    throw new ApplyConflictError([
      conflict(
        { entity: 'exchange', id: step.id, reason: CommitReason.MISSING, actual_status: target },
        step.revision - 1,
        0,
      ),
    ]);
  }

  const current = snapshot.exchanges[index];
  if (current.status === target || (target === ExchangeStatus.ACCEPTED && current.status === ExchangeStatus.COMPLETED)) {
    return { exchanges: snapshot.exchanges, applied: true };
  }
  if (
    target === ExchangeStatus.REJECTED &&
    ![ExchangeStatus.PENDING, ExchangeStatus.REJECTED].includes(current.status)
  ) {
    throw new ApplyConflictError([
      conflict(
        {
          entity: 'exchange',
          id: current.id,
          title: exchangeTitle(current, snapshot.items),
          reason: CommitReason.ILLEGAL_TRANSITION,
          actual_status: current.status,
          expected_status: target,
        },
        step.revision - 1,
        current.revision,
      ),
    ]);
  }
  if (!EXCHANGE_ACTION_FLOW[current.status].includes(target) && target !== ExchangeStatus.REJECTED) {
    throw new ApplyConflictError([
      conflict(
        {
          entity: 'exchange',
          id: current.id,
          title: exchangeTitle(current, snapshot.items),
          reason: CommitReason.ILLEGAL_TRANSITION,
          actual_status: current.status,
          expected_status: target,
        },
        step.revision - 1,
        current.revision,
      ),
    ]);
  }

  const nextExchange: Exchange = {
    ...current,
    status: target,
    revision: current.revision + 1,
    updated_at: new Date().toISOString(),
  };
  const exchanges = snapshot.exchanges.map((entry) => (entry.id === step.id ? nextExchange : entry));
  return { exchanges, applied: false };
};

const applyItemStepSync = (
  step: CommitStep,
  snapshot: Snapshot,
  batchExchangeId: string,
): { items: Item[]; applied: boolean } => {
  const target = step.status as ItemStatus;
  const current = snapshot.items.find((entry) => entry.id === step.id);
  if (!current) {
    throw new ApplyConflictError([
      conflict(
        { entity: 'item', id: step.id, reason: CommitReason.MISSING, actual_status: target },
        step.revision - 1,
        0,
      ),
    ]);
  }

  // 目标是锁定态时，必须确认锁属于本批次的交换，
  // 否则是别的交换在并发中先锁住了物品（含崩溃重放），属于分歧冲突
  if (
    target === ItemStatus.BOOKED &&
    current.status === ItemStatus.BOOKED &&
    current.locked_by_exchange_id &&
    current.locked_by_exchange_id !== batchExchangeId
  ) {
    throw new ApplyConflictError([
      conflict(
        {
          entity: 'item',
          id: current.id,
          title: current.title,
          reason: CommitReason.LOCKED_ELSEWHERE,
          actual_status: current.status,
          expected_status: target,
          related_exchange_id: current.locked_by_exchange_id,
        },
        step.revision - 1,
        current.revision,
      ),
    ]);
  }

  // 已到达目标状态（含崩溃后重放、锁归属一致）：按 provenance 幂等跳过
  if (current.status === target) {
    return { items: snapshot.items, applied: true };
  }
  // 同意步骤的物品在非锁定态下已被别的交换锁定：分歧冲突
  if (
    current.status === ItemStatus.BOOKED &&
    current.locked_by_exchange_id &&
    current.locked_by_exchange_id !== batchExchangeId
  ) {
    throw new ApplyConflictError([
      conflict(
        {
          entity: 'item',
          id: current.id,
          title: current.title,
          reason: CommitReason.LOCKED_ELSEWHERE,
          actual_status: current.status,
          expected_status: target,
          related_exchange_id: current.locked_by_exchange_id,
        },
        step.revision - 1,
        current.revision,
      ),
    ]);
  }

  const legal =
    (target === ItemStatus.BOOKED && current.status === ItemStatus.AVAILABLE) ||
    (target === ItemStatus.EXCHANGED && current.status === ItemStatus.BOOKED) ||
    (target === ItemStatus.OFFLINE && current.status === ItemStatus.AVAILABLE);
  if (!legal) {
    throw new ApplyConflictError([
      conflict(
        {
          entity: 'item',
          id: current.id,
          title: current.title,
          reason: CommitReason.UNEXPECTED_STATUS,
          actual_status: current.status,
          expected_status: target,
        },
        step.revision - 1,
        current.revision,
      ),
    ]);
  }

  const nextItem: Item = {
    ...current,
    status: target,
    revision: current.revision + 1,
    locked_by_exchange_id:
      target === ItemStatus.BOOKED
        ? batchExchangeId
        : target === ItemStatus.EXCHANGED || target === ItemStatus.OFFLINE
          ? undefined
          : current.locked_by_exchange_id,
  };
  return {
    items: snapshot.items.map((entry) => (entry.id === step.id ? nextItem : entry)),
    applied: false,
  };
};

const insertDraftExchange = (batch: CommitBatch, snapshot: Snapshot): Snapshot => {
  if (!batch.draft_exchange_id || !batch.draft_exchange) return snapshot;
  if (snapshot.exchanges.some((entry) => entry.id === batch.draft_exchange_id)) {
    return snapshot;
  }
  const draft = batch.draft_exchange as unknown as CreateExchangeRequest;
  const timestamp = new Date().toISOString();
  const nextExchange: Exchange = {
    id: batch.draft_exchange_id,
    from_user_id: draft.from_user_id,
    to_user_id: draft.to_user_id,
    from_item_id: draft.from_item_id,
    to_item_id: draft.to_item_id,
    status: ExchangeStatus.PENDING,
    message: draft.message,
    revision: 1,
    created_at: timestamp,
    updated_at: timestamp,
  };
  return { ...snapshot, exchanges: [nextExchange, ...snapshot.exchanges] };
};

const persistProgress = async (batch: CommitBatch) => {
  const outbox = await getOutbox();
  const next = outbox.map((entry) => (entry.id === batch.id ? { ...batch, updated_at: new Date().toISOString() } : entry));
  await setOutbox(next);
};

/**
 * 纯内存演练：从存储当前状态出发顺序套用所有未完成步骤，
 * 任一步骤不可行立即抛出，不产生任何写入。恢复时据此保证“要么整批推进、要么原样保留”。
 */
const simulateBatch = (batch: CommitBatch, initial: Snapshot): Snapshot => {
  let sim = initial;
  if (batch.kind === CommitKind.CREATE_EXCHANGE && !batch.steps[0]?.applied) {
    sim = insertDraftExchange(batch, sim);
  }
  for (const step of batch.steps) {
    if (step.applied) continue;
    const batchExchangeId = findBatchExchangeId(batch) ?? '';
    if (step.entity === 'exchange') {
      if (step.index === 0 && batch.kind === CommitKind.CREATE_EXCHANGE) continue;
      const result = applyExchangeStepSync(step, sim);
      if (!result.applied) sim = { ...sim, exchanges: result.exchanges };
    } else {
      const result = applyItemStepSync(step, sim, batchExchangeId);
      if (!result.applied) sim = { ...sim, items: result.items };
    }
  }
  return sim;
};

/** 按步骤顺序落库，依据 provenance 与状态机前置条件实现崩溃重放幂等 */
const applyBatch = async (batch: CommitBatch): Promise<CommitBatch> => {
  let snapshot = await readSnapshot();

  // 先演练，分歧冲突时整批不写、原样留在 outbox 等待重试/放弃
  simulateBatch(batch, snapshot);

  if (batch.kind === CommitKind.CREATE_EXCHANGE && !batch.steps[0]?.applied) {
    const inserted = insertDraftExchange(batch, snapshot);
    await writeExchanges(inserted.exchanges);
    snapshot = inserted;
    batch.steps[0].applied = true;
    await persistProgress(batch);
  }

  for (const step of batch.steps) {
    if (step.applied) continue;
    const batchExchangeId = findBatchExchangeId(batch) ?? '';
    if (step.entity === 'exchange') {
      if (step.index === 0 && batch.kind === CommitKind.CREATE_EXCHANGE) {
        step.applied = true;
        await persistProgress(batch);
        continue;
      }
      const result = applyExchangeStepSync(step, snapshot);
      if (!result.applied) {
        await writeExchanges(result.exchanges);
        snapshot = { ...snapshot, exchanges: result.exchanges };
      }
    } else {
      const result = applyItemStepSync(step, snapshot, batchExchangeId);
      if (!result.applied) {
        await writeItems(result.items);
        snapshot = { ...snapshot, items: result.items };
      }
    }
    step.applied = true;
    await persistProgress(batch);
  }

  return batch;
};

/* -------------------------------- 对外 API -------------------------------- */

export interface RecoverSummary {
  committed: CommitBatch[];
  failed: CommitBatch[];
}

export const commitApi = {
  async prepareCreate(request: CreateExchangeRequest): Promise<CommitBatch> {
    const snapshot = await readSnapshot();
    return buildCreateBatch(snapshot, request);
  },

  async prepareTransition(
    kind: CommitKind.ACCEPT_EXCHANGE | CommitKind.REJECT_EXCHANGE | CommitKind.COMPLETE_EXCHANGE,
    request: ExchangeTransitionRequest,
  ): Promise<CommitBatch> {
    const snapshot = await readSnapshot();
    const exchange = snapshot.exchanges.find((entry) => entry.id === request.exchangeId);
    if (!exchange) {
      throw new CommitConflictError([
        conflict(
          { entity: 'exchange', id: request.exchangeId, reason: CommitReason.MISSING },
          request.expectedExchangeRevision,
          0,
        ),
      ]);
    }
    return buildTransitionBatch(snapshot, kind, request);
  },

  async prepareOffline(request: OfflineItemRequest): Promise<CommitBatch> {
    return buildOfflineBatch(request);
  },

  /** 提交：守卫通过才落 outbox，交换与物品在同一批次内一起成功或留下可重试批次 */
  async submit(draftBatch: CommitBatch): Promise<CommitBatch> {
    return withSameTabQueue(async () => {
      await acquireLock();
      let batch = draftBatch;
      try {
        const snapshot = await readSnapshot();
        const conflicts = validateGuards(batch, snapshot);
        if (conflicts.length) {
          throw new CommitConflictError(conflicts);
        }
        const outbox = await getOutbox();
        await setOutbox([...outbox, batch]);
        batch = await applyBatch(batch);
        await setOutbox((await getOutbox()).filter((entry) => entry.id !== batch.id));
        return batch;
      } catch (error) {
        if (error instanceof ApplyConflictError) {
          batch.status = CommitBatchStatus.FAILED_CONFLICT;
          batch.conflicts = error.conflicts;
          await persistProgress(batch);
        }
        throw error;
      } finally {
        await releaseLock();
      }
    });
  },

  /** 恢复 outbox 中未完成的批次；不重跑守卫，只做幂等落库 */
  async recoverPending(): Promise<RecoverSummary> {
    return withSameTabQueue(async () => {
      const pending = (await getOutbox())
        .filter((batch) => batch.status === CommitBatchStatus.PENDING)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      const committed: CommitBatch[] = [];
      const failed: CommitBatch[] = [];
      if (!pending.length) return { committed, failed };

      await acquireLock();
      try {
        for (const batch of pending) {
          try {
            await applyBatch(batch);
            await setOutbox((await getOutbox()).filter((entry) => entry.id !== batch.id));
            committed.push(batch);
          } catch (error) {
            if (error instanceof ApplyConflictError) {
              batch.status = CommitBatchStatus.FAILED_CONFLICT;
              batch.conflicts = error.conflicts;
              await persistProgress(batch);
              failed.push(batch);
            } else {
              throw error;
            }
          }
        }
      } finally {
        await releaseLock();
      }
      return { committed, failed };
    });
  },

  async listBatches(): Promise<CommitBatch[]> {
    return getOutbox();
  },

  async discardBatch(id: string): Promise<void> {
    await setOutbox((await getOutbox()).filter((entry) => entry.id !== id));
  },
};
