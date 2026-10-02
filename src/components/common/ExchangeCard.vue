<template>
  <article class="exchange-card">
    <header>
      <span class="status-pill" :class="statusToneClass(exchange.status)">
        {{ formatExchangeStatus(exchange.status) }}
      </span>
      <small>{{ formatDate(exchange.updated_at) }} · r{{ exchange.revision }}</small>
    </header>
    <div class="exchange-card__items">
      <div>
        <span>拿出</span>
        <strong>{{ fromItem?.title ?? '未知物品' }}</strong>
        <small v-if="fromItem" class="revision-tag">
          {{ formatItemStatus(fromItem.status) }} · r{{ fromItem.revision }}
        </small>
      </div>
      <div>
        <span>换取</span>
        <strong>{{ toItem?.title ?? '未知物品' }}</strong>
        <small v-if="toItem" class="revision-tag">
          {{ formatItemStatus(toItem.status) }} · r{{ toItem.revision }}
        </small>
      </div>
    </div>
    <p>{{ exchange.message || formatStatusMessage(exchange.status) }}</p>
    <footer>
      <span v-if="fromUser && toUser">{{ fromUser.nickname }} → {{ toUser.nickname }}</span>
      <div v-if="canOperate" class="exchange-card__actions">
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="emitDecision('accept')">
          同意
        </button>
        <button v-if="exchange.status === ExchangeStatus.PENDING" type="button" @click="emitDecision('reject')">
          拒绝
        </button>
        <button v-if="exchange.status === ExchangeStatus.ACCEPTED" type="button" @click="emitDecision('complete')">
          完成
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { ExchangeStatus } from '@/constants/exchange';
import type { Exchange, ExchangeSubmitPayload } from '@/models/exchange';
import type { Item } from '@/models/item';
import type { User } from '@/models/user';
import { useAuthStore } from '@/stores/authStore';
import {
  formatDate,
  formatExchangeStatus,
  formatItemStatus,
  formatStatusMessage,
  statusToneClass,
} from '@/utils/formatters';
import { exchangeSubmitPayload } from '@/utils/revisionHelpers';

const props = defineProps<{
  exchange: Exchange;
  items: Item[];
  users: User[];
}>();

const emit = defineEmits<{
  accept: [exchange: Exchange, payload: ExchangeSubmitPayload];
  reject: [exchange: Exchange, payload: ExchangeSubmitPayload];
  complete: [exchange: Exchange, payload: ExchangeSubmitPayload];
}>();

const authStore = useAuthStore();
const fromItem = computed(() => props.items.find((item) => item.id === props.exchange.from_item_id));
const toItem = computed(() => props.items.find((item) => item.id === props.exchange.to_item_id));
const fromUser = computed(() => props.users.find((user) => user.id === props.exchange.from_user_id));
const toUser = computed(() => props.users.find((user) => user.id === props.exchange.to_user_id));
const canOperate = computed(
  () =>
    authStore.currentUser?.id === props.exchange.to_user_id ||
    (authStore.currentUser?.id === props.exchange.from_user_id && props.exchange.status === ExchangeStatus.ACCEPTED),
);

const emitDecision = (decision: 'accept' | 'reject' | 'complete') => {
  const involved = [fromItem.value, toItem.value].filter((item): item is Item => Boolean(item));
  if (involved.length !== 2) return;
  const action =
    decision === 'accept'
      ? ExchangeStatus.ACCEPTED
      : decision === 'reject'
        ? ExchangeStatus.REJECTED
        : ExchangeStatus.COMPLETED;
  const payload = exchangeSubmitPayload(props.exchange, involved, action);
  if (decision === 'accept') emit('accept', props.exchange, payload);
  else if (decision === 'reject') emit('reject', props.exchange, payload);
  else emit('complete', props.exchange, payload);
};
</script>
