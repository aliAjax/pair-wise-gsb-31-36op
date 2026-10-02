import type { PendingBatch } from '@/types';

import { storage, STORAGE_KEYS } from '@/utils/storage';

export const batchApi = {
  async list(): Promise<PendingBatch[]> {
    return storage.get<PendingBatch[]>(STORAGE_KEYS.pendingBatches, []);
  },

  async add(batch: PendingBatch): Promise<PendingBatch[]> {
    const batches = await this.list();
    const next = [batch, ...batches.filter((item) => item.id !== batch.id)];
    await storage.set(STORAGE_KEYS.pendingBatches, next);
    return next;
  },

  async update(id: string, patch: Partial<PendingBatch>): Promise<PendingBatch[]> {
    const batches = await this.list();
    const next = batches.map((batch) =>
      batch.id === id ? { ...batch, ...patch, attempts: batch.attempts + 1 } : batch,
    );
    await storage.set(STORAGE_KEYS.pendingBatches, next);
    return next;
  },

  async remove(id: string): Promise<PendingBatch[]> {
    const batches = await this.list();
    const next = batches.filter((batch) => batch.id !== id);
    await storage.set(STORAGE_KEYS.pendingBatches, next);
    return next;
  },
};
