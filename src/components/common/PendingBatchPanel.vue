<template>
  <section v-if="batches.length" class="pending-panel">
    <h2>{{ CONFLICT_MESSAGES.pendingTitle }}（{{ batches.length }}）</h2>
    <article v-for="batch in batches" :key="batch.id" class="pending-card">
      <header class="pending-card__head">
        <span class="status-pill" :class="batch.state === 'conflict' ? 'status-wait' : 'status-muted'">
          {{ batch.state === 'conflict' ? '版本冲突' : '待重试' }}
        </span>
        <small>{{ describeOperation(batch.operation) }}</small>
      </header>

      <p v-if="batch.last_error" class="pending-card__error">{{ batch.last_error }}</p>

      <ul v-if="batch.conflict?.changes.length" class="pending-card__changes">
        <li v-for="(change, index) in batch.conflict.changes" :key="`${change.id}-${index}`">
          对方改动：{{ formatRemoteChange(change) }}
        </li>
      </ul>
      <ul v-if="batch.conflict?.details.length" class="pending-card__revisions">
        <li v-for="(detail, index) in batch.conflict.details" :key="`${detail.id}-rev-${index}`">
          {{ detail.kind === 'exchange' ? '交换请求' : detail.title ?? '物品' }}：
          {{ formatRevisionHint(detail.expected, detail.actual) }}
        </li>
      </ul>

      <footer class="pending-card__actions">
        <button class="primary-button" type="button" :disabled="recoveryStore.running" @click="recoveryStore.retry(batch.id)">
          {{ CONFLICT_MESSAGES.retry }}
        </button>
        <button class="secondary-button" type="button" :disabled="recoveryStore.running" @click="recoveryStore.dismiss(batch.id)">
          {{ CONFLICT_MESSAGES.dismiss }}
        </button>
      </footer>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { CONFLICT_MESSAGES } from '@/constants/messages';
import { useRecoveryStore } from '@/stores/recoveryStore';
import type { PendingBatch } from '@/types';
import { formatRemoteChange, formatRevisionHint } from '@/utils/formatters';

const props = defineProps<{
  batches: PendingBatch[];
}>();

const recoveryStore = useRecoveryStore();
const batches = computed(() => props.batches);

const describeOperation = (batch: PendingBatch['operation']): string => {
  if (batch.kind === 'create-exchange') return '发起交换';
  if (batch.kind === 'item-offline') return '下架物品';
  if (batch.payload.action === 'accepted') return '同意交换';
  if (batch.payload.action === 'rejected') return '拒绝交换';
  return '完成交换';
};
</script>
