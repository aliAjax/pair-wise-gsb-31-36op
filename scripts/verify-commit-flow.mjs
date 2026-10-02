// 临时端到端验证台：内存 localStorage + idb 垫片，跑通乐观锁/批次恢复/迁移
import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'reswap-test-'));

const idbShim = `
const store = globalThis.__IDB__;
export const get = async (k) => (store.has(k) ? JSON.parse(JSON.stringify(store.get(k))) : undefined);
export const set = async (k, v) => { store.set(k, JSON.parse(JSON.stringify(v))); };
export const del = async (k) => { store.delete(k); };
`;
writeFileSync(join(dir, 'idb-shim.js'), idbShim);

// 内存 localStorage
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.__IDB__ = new Map();

const entry = join(dir, 'entry.ts');
writeFileSync(
  entry,
  `
export { storage, STORAGE_KEYS } from '@/utils/storage';
export { commitApi } from '@/api/commitApi';
export { CommitKind, CommitBatchStatus, CommitReason } from '@/constants/commit';
export { ExchangeStatus } from '@/constants/exchange';
export { ItemStatus } from '@/constants/item';
export { CommitConflictError } from '@/utils/commitError';
`,
);

const result = await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
  alias: {
    '@': '/workspace/src',
    'idb-keyval': join(dir, 'idb-shim.js'),
  },
});

const outfile = join(dir, 'bundle.mjs');
writeFileSync(outfile, result.outputFiles[0].text);
const mod = await import(pathToFileURL(outfile).href);
const { storage, STORAGE_KEYS, commitApi, CommitKind, CommitBatchStatus, CommitReason, ExchangeStatus, ItemStatus } = mod;

let passed = 0;
let failed = 0;
const assert = (cond, name, extra) => {
  if (cond) { passed++; console.log('  ✓', name); }
  else { failed++; console.error('  ✗', name, extra ?? ''); }
};
const reset = async () => {
  globalThis.localStorage.clear();
  globalThis.__IDB__.clear();
};

const seedV2 = async (overrides = {}) => {
  const items = [
    { id: 'chair', user_id: 'u_me', title: '露营椅', status: ItemStatus.AVAILABLE, revision: 1, images: [], locked_by_exchange_id: undefined },
    { id: 'camera', user_id: 'u_lin', title: '拍立得', status: ItemStatus.AVAILABLE, revision: 1, images: [], locked_by_exchange_id: undefined },
    { id: 'lamp', user_id: 'u_lin', title: '小夜灯', status: ItemStatus.AVAILABLE, revision: 1, images: [] },
  ];
  const exchanges = [
    {
      id: 'ex1', from_user_id: 'u_me', to_user_id: 'u_lin',
      from_item_id: 'chair', to_item_id: 'camera',
      status: ExchangeStatus.PENDING, message: '换', revision: 1,
      created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    },
  ];
  await storage.set(STORAGE_KEYS.items, items);
  await storage.set(STORAGE_KEYS.exchanges, exchanges);
  if (overrides.items) await storage.set(STORAGE_KEYS.items, overrides.items);
  if (overrides.exchanges) await storage.set(STORAGE_KEYS.exchanges, overrides.exchanges);
  return { items, exchanges };
};

const acceptReq = (revs = { ex: 1, fi: 1, ti: 1 }) => ({
  exchangeId: 'ex1',
  expectedExchangeRevision: revs.ex,
  expectedFromItemRevision: revs.fi,
  expectedToItemRevision: revs.ti,
});

/* ---- 场景 1：确认交换原子成功，物品一起锁定，修订号自增 ---- */
console.log('\n[1] 确认交换：交换与两侧物品一起成功');
await reset();
await seedV2();
const batch = await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq());
await commitApi.submit(batch);
{
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  const its = await storage.get(STORAGE_KEYS.items, []);
  const ex = exs.find((e) => e.id === 'ex1');
  const chair = its.find((i) => i.id === 'chair');
  const camera = its.find((i) => i.id === 'camera');
  assert(ex.status === ExchangeStatus.ACCEPTED && ex.revision === 2, '交换为已同意且修订号 1→2', ex);
  assert(chair.status === ItemStatus.BOOKED && chair.revision === 2, '拿出物品锁定且修订号 1→2', chair);
  assert(camera.status === ItemStatus.BOOKED && camera.revision === 2, '换取物品锁定且修订号 1→2', camera);
  assert(chair.locked_by_exchange_id === 'ex1' && camera.locked_by_exchange_id === 'ex1', '物品锁定来源是 ex1');
  const outbox = await commitApi.listBatches();
  assert(outbox.length === 0, '成功后 outbox 无残留批次');
}

/* ---- 场景 2：旧页面用旧修订号拒绝 → 冲突，不落批次，数据不变 ---- */
console.log('\n[2] 页面落后：旧修订号被拒绝，保留输入所需的冲突详情');
await reset();
await seedV2();
{
  const first = await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq());
  await commitApi.submit(first);
  let caught = null;
  try {
    const stale = await commitApi.prepareTransition(CommitKind.REJECT_EXCHANGE, acceptReq());
    await commitApi.submit(stale);
  } catch (e) { caught = e; }
  assert(caught && caught.name === 'CommitConflictError', '抛出 CommitConflictError');
  const reasons = (caught?.conflicts ?? []).map((c) => c.reason);
  assert(reasons.includes(CommitReason.REVISION_STALE) || reasons.includes(CommitReason.UNEXPECTED_STATUS),
    '冲突原因是修订落后或状态变化', reasons);
  const outbox = await commitApi.listBatches();
  assert(outbox.length === 0, '守卫失败不留下批次');
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs.find((e) => e.id === 'ex1').status === ExchangeStatus.ACCEPTED, '已同意结果未被旧页面盖回去');
}

/* ---- 场景 3：崩溃在交换已写、物品未写 → 恢复补完，不重复写交换 ---- */
console.log('\n[3] 提交中断：outbox 批次可恢复，交换记录不重复');
await reset();
await seedV2();
{
  const prepared = await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq());
  // 模拟第 0 步落库后崩溃：交换 accepted/rev2，物品仍 available/rev1
  const crashExchanges = [
    { ...(await storage.get(STORAGE_KEYS.exchanges, [])).find((e) => e.id === 'ex1'),
      status: ExchangeStatus.ACCEPTED, revision: 2, updated_at: new Date().toISOString() },
  ];
  await storage.set(STORAGE_KEYS.exchanges, crashExchanges);
  prepared.steps[0].applied = true; // 交换步骤已落
  prepared.steps.forEach((s, i) => { if (i > 0) s.applied = false; });
  await storage.set(STORAGE_KEYS.commitOutbox, [prepared]);

  const summary = await commitApi.recoverPending();
  assert(summary.committed.length === 1, '恢复了 1 笔批次');
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  const its = await storage.get(STORAGE_KEYS.items, []);
  assert(exs.filter((e) => e.id === 'ex1').length === 1, '交换记录仍只有一条（未重复生成）');
  assert(exs[0].revision === 2, '交换修订号停留在 2（恢复幂等不重复自增）', exs[0]);
  const chair = its.find((i) => i.id === 'chair');
  const camera = its.find((i) => i.id === 'camera');
  assert(chair.status === ItemStatus.BOOKED && chair.revision === 2, '恢复后拿出物品锁定', chair);
  assert(camera.status === ItemStatus.BOOKED && camera.revision === 2, '恢复后换取物品锁定', camera);
  assert((await commitApi.listBatches()).length === 0, '恢复成功后批次清除');
}

/* ---- 场景 4：已锁定物品不能再发起交换；重复对被拦截 ---- */
console.log('\n[4] 已锁定物品不可再发起交换 / 重复交换拦截');
await reset();
await seedV2();
{
  await commitApi.submit(await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq()));
  let caught = null;
  try {
    const create = await commitApi.prepareCreate({
      from_user_id: 'u_me', to_user_id: 'u_chen',
      from_item_id: 'chair', to_item_id: 'lamp', message: '再换',
      expected_from_item_revision: 2, expected_to_item_revision: 1,
    });
    await commitApi.submit(create);
  } catch (e) { caught = e; }
  assert(caught?.name === 'CommitConflictError', '锁定物品发起交换被拒');
  assert(
    caught?.conflicts.some((c) => c.entity === 'item' && c.id === 'chair'),
    '冲突指向已锁定的 chair',
    caught?.conflicts,
  );
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs.length === 1, '没有产生新交换记录');
}

/* ---- 场景 4b：两件可交换物品重复发起同一交换 ---- */
await reset();
await seedV2({ exchanges: [] });
{
  const mk = () =>
    commitApi.prepareCreate({
      from_user_id: 'u_me', to_user_id: 'u_lin',
      from_item_id: 'chair', to_item_id: 'camera', message: '换',
      expected_from_item_revision: 1, expected_to_item_revision: 1,
    });
  let firstCaught = null;
  try { await commitApi.submit(await mk()); } catch (e) { firstCaught = e; }
  assert(firstCaught === null, '首次发起成功');
  let caught = null;
  try { await commitApi.submit(await mk()); } catch (e) { caught = e; }
  assert(caught?.conflicts?.some((c) => c.reason === CommitReason.DUPLICATE_EXCHANGE), '重复交换被去重拦截');
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs.length === 1, '只生成一条交换记录');
}

/* ---- 场景 5：下架与关联待确认交换在同一批次内一起成功 ---- */
console.log('\n[5] 物品下架：物品与相关交换原子更新');
await reset();
await seedV2();
{
  const off = await commitApi.prepareOffline({
    itemId: 'chair',
    expectedItemRevision: 1,
    pendingExchanges: [{ id: 'ex1', revision: 1 }],
  });
  await commitApi.submit(off);
  const its = await storage.get(STORAGE_KEYS.items, []);
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(its.find((i) => i.id === 'chair').status === ItemStatus.OFFLINE, 'chair 已下架');
  assert(exs.find((e) => e.id === 'ex1').status === ExchangeStatus.REJECTED, '关联待确认交换被拒绝');
  assert((await commitApi.listBatches()).length === 0, '无残留批次');
}

/* ---- 场景 5b：物品已被同意交换锁定 → 下架冲突 ---- */
await reset();
await seedV2();
{
  await commitApi.submit(await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq()));
  let caught = null;
  try {
    // 旧页面看到的仍是 available/rev1
    const off = await commitApi.prepareOffline({ itemId: 'chair', expectedItemRevision: 1, pendingExchanges: [] });
    await commitApi.submit(off);
  } catch (e) { caught = e; }
  assert(caught?.name === 'CommitConflictError', '锁定物品下架被拒');
  assert((await storage.get(STORAGE_KEYS.items, [])).find((i) => i.id === 'chair').status === ItemStatus.BOOKED,
    '物品保持锁定未被旧页面下架');
}

/* ---- 场景 6：完成交换：BOOKED→EXCHANGED，两侧一起成功 ---- */
console.log('\n[6] 完成交换：两侧物品变为已交换');
await reset();
await seedV2();
{
  await commitApi.submit(await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq()));
  const complete = await commitApi.prepareTransition(
    CommitKind.COMPLETE_EXCHANGE,
    { exchangeId: 'ex1', expectedExchangeRevision: 2, expectedFromItemRevision: 2, expectedToItemRevision: 2 },
  );
  await commitApi.submit(complete);
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  const its = await storage.get(STORAGE_KEYS.items, []);
  assert(exs[0].status === ExchangeStatus.COMPLETED && exs[0].revision === 3, '交换完成 rev3');
  assert(its.find((i) => i.id === 'chair').status === ItemStatus.EXCHANGED, 'chair 已交换');
  assert(its.find((i) => i.id === 'camera').status === ItemStatus.EXCHANGED, 'camera 已交换');
  assert(its.find((i) => i.id === 'chair').locked_by_exchange_id === undefined, '锁标记已清除');
}

/* ---- 场景 7：恢复时发现状态分歧 → 批次保留为 failed_conflict 可重试/放弃 ---- */
console.log('\n[7] 恢复冲突：批次保留，不破坏数据');
await reset();
await seedV2();
{
  const prepared = await commitApi.prepareTransition(CommitKind.ACCEPT_EXCHANGE, acceptReq());
  // 物品被另一笔交换锁定（模拟其他提交），而崩溃批次仍要把 available→booked
  const its = await storage.get(STORAGE_KEYS.items, []);
  const tampered = its.map((i) =>
    i.id === 'chair' ? { ...i, status: ItemStatus.BOOKED, revision: 3, locked_by_exchange_id: 'other_ex' } : i,
  );
  await storage.set(STORAGE_KEYS.items, tampered);
  prepared.steps.forEach((s) => (s.applied = false));
  await storage.set(STORAGE_KEYS.commitOutbox, [prepared]);
  const summary = await commitApi.recoverPending();
  assert(summary.failed.length === 1, '分歧批次进入 failed');
  const left = await commitApi.listBatches();
  assert(left.length === 1 && left[0].status === CommitBatchStatus.FAILED_CONFLICT, '失败批次保留可重试');
  assert(left[0].conflicts.length > 0, '保留冲突详情');
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs[0].status === ExchangeStatus.PENDING, '交换未被错误推进');
}

/* ---- 场景 7b：发起交换时崩溃（交换记录尚未写入）→ 恢复补写且 id 幂等 ---- */
console.log('\n[7b] 发起交换中断：恢复补写，交换记录不重复');
await reset();
await seedV2({ exchanges: [] });
{
  const prepared = await commitApi.prepareCreate({
    from_user_id: 'u_me', to_user_id: 'u_lin',
    from_item_id: 'chair', to_item_id: 'camera', message: '换',
    expected_from_item_revision: 1, expected_to_item_revision: 1,
  });
  // 批次落 outbox 后、任何写入前崩溃
  await storage.set(STORAGE_KEYS.commitOutbox, [prepared]);
  const preId = prepared.draft_exchange_id;
  const summary = await commitApi.recoverPending();
  assert(summary.committed.length === 1, '恢复了发起批次');
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs.length === 1 && exs[0].id === preId, '用预生成 id 补写唯一交换记录', { exs, preId });
  assert(exs[0].revision === 1 && exs[0].status === ExchangeStatus.PENDING, '补写交换为待确认 rev1');

  // 再次恢复（重复触发）不会再插入
  await commitApi.recoverPending();
  const exs2 = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs2.length === 1, '重复恢复不产生第二条记录');
}

/* ---- 场景 8：拒绝交换原子成功，物品保持可交换 ---- */
console.log('\n[8] 拒绝交换：交换更新，物品不动');
await reset();
await seedV2();
{
  await commitApi.submit(await commitApi.prepareTransition(CommitKind.REJECT_EXCHANGE, acceptReq()));
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  const its = await storage.get(STORAGE_KEYS.items, []);
  assert(exs[0].status === ExchangeStatus.REJECTED && exs[0].revision === 2, '交换已拒绝 rev2');
  assert(its.every((i) => i.status === ItemStatus.AVAILABLE), '物品全部保持可交换');
}

/* ---- 场景 9：v1 旧数据迁移补修订号 + 状态对账 ---- */
console.log('\n[9] 旧数据迁移：补修订信息，首页/详情认同一版本');
await reset();
{
  const v1Envelope = (payload) => JSON.stringify({ version: 1, expiresAt: Date.now() + 1e10, payload });
  const oldItems = [
    { id: 'chair', user_id: 'u_me', title: '露营椅', status: 'available', images: [] },
    { id: 'camera', user_id: 'u_lin', title: '拍立得', status: 'available', images: [] },
    { id: 'done', user_id: 'u_lin', title: '旧灯', status: 'available', images: [] },
  ];
  const oldExchanges = [
    { id: 'exAcc', from_user_id: 'u_me', to_user_id: 'u_lin', from_item_id: 'chair', to_item_id: 'camera',
      status: 'accepted', message: '', created_at: '', updated_at: '' },
    { id: 'exDone', from_user_id: 'u_me', to_user_id: 'u_lin', from_item_id: 'done', to_item_id: 'x',
      status: 'completed', message: '', created_at: '', updated_at: '' },
  ];
  globalThis.localStorage.setItem(STORAGE_KEYS.items, v1Envelope(oldItems));
  globalThis.localStorage.setItem(STORAGE_KEYS.exchanges, v1Envelope(oldExchanges));

  await storage.migrate();
  const its = await storage.get(STORAGE_KEYS.items, []);
  const exs = await storage.get(STORAGE_KEYS.exchanges, []);
  assert(exs.every((e) => e.revision === 1), '旧交换全部补齐 revision=1');
  assert(its.every((i) => i.revision === 1), '旧物品全部补齐 revision=1');
  assert(its.find((i) => i.id === 'chair').status === ItemStatus.BOOKED, '已同意交换的物品对账为锁定');
  assert(its.find((i) => i.id === 'camera').locked_by_exchange_id === 'exAcc', '锁定来源正确');
  assert(its.find((i) => i.id === 'done').status === ItemStatus.EXCHANGED, '已完成交换的物品对账为已交换');
  // 迁移后能立刻用新修订号完成正常提交
  const batch = await commitApi.prepareOffline({ itemId: 'done', expectedItemRevision: 1, pendingExchanges: [] });
  // done 已是 exchanged，应冲突，验证迁移后的版本就是当前有效版本
  let caught = null;
  try { await commitApi.submit(batch); } catch (e) { caught = e; }
  assert(caught?.name === 'CommitConflictError', '迁移后的修订号立即参与乐观锁校验');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
