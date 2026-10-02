<template>
  <article class="exchange-card">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(exchange.updated_at) }}</small>
    </header>
    <div class="exchange-card__items">
      <div>
        <span>拿出</span>
        <strong>{{ fromItem?.title ?? '未知物品' }}</strong>
        <small v-if="fromItem" class="revision-tag">修订 {{ fromItem.revision }}</small>
      </div>
      <div>
        <span>换取</span>
        <strong>{{ toItem?.title ?? '未知物品' }}</strong>
        <small v-if="toItem" class="revision-tag">修订 {{ toItem.revision }}</small>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>

    <CommitConflictPanel
      v-if="conflict"
      :conflicts="conflict.conflicts"
      title="这个操作没能提交"
      hint="交换或物品已被另一个页面改动，操作按钮已按最新数据更新，确认后可直接重试。"
    />

    <footer>
      <span v-if="fromUser && toUser">{{ fromUser.nickname }} → {{ toUser.nickname }}</span>
      <div v-if="canOperate" class="exchange-card__actions">
        <button
          v-if="exchange.status === ExchangeStatus.PENDING"
          type="button"
          :disabled="commitStore.busy"
          @click="emitAction('accept')"
        >
          同意
        </button>
        <button
          v-if="exchange.status === ExchangeStatus.PENDING"
          type="button"
          :disabled="commitStore.busy"
          @click="emitAction('reject')"
        >
          拒绝
        </button>
        <button
          v-if="exchange.status === ExchangeStatus.ACCEPTED"
          type="button"
          :disabled="commitStore.busy"
          @click="emitAction('complete')"
        >
          完成
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import CommitConflictPanel from '@/components/common/CommitConflictPanel.vue';
import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import { useCommitStore, type StoredConflict } from '@/stores/commitStore';
import { formatDate, formatExchangeStatus, formatStatusMessage, statusToneClass } from '@/utils/formatters';

export interface ExchangeActionPayload {
  id: string;
  exchangeRevision: number;
  fromItemRevision: number;
  toItemRevision: number;
}

const props = defineProps<{
  exchange: Exchange;
  items: Item[];
  users: User[];
  conflict?: StoredConflict | null;
}>();

const emit = defineEmits<{
  accept: [payload: ExchangeActionPayload];
  reject: [payload: ExchangeActionPayload];
  complete: [payload: ExchangeActionPayload];
}>();

const authStore = useAuthStore();
const commitStore = useCommitStore();
const fromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const toItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const fromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));
const canOperate = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    (authStore.currentUser?.id === props.exchange.from_user_id && props.exchange.status === ExchangeStatus.ACCEPTED),
);

/** 始终用 hydrate 后的最新修订号发起，旧标签页在冲突刷新后重试也不会覆盖新结果 */
const emitAction = (action: 'accept' | 'reject' | 'complete') => {
  const payload: ExchangeActionPayload = {
    id: props.exchange.id,
    exchangeRevision: props.exchange.revision,
    fromItemRevision: fromItem.value?.revision ?? 0,
    toItemRevision: toItem.value?.revision ?? 0,
  };
  if (action === 'accept') emit('accept', payload);
  if (action === 'reject') emit('reject', payload);
  if (action === 'complete') emit('complete', payload);
};
</script>
