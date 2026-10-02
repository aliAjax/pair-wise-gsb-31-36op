<template>
  <section v-if="item" class="page detail-page">
    <RouterLink class="text-link" to="/home">返回首页</RouterLink>
    <div class="detail-layout">
      <ItemImageGallery :images="item.images" :fallback-text="item.category" />
      <article class="detail-panel">
        <div class="item-card__topline">
          <span class="pill">{{ item.category }}</span>
          <span class="status-pill" :class="statusToneClass(item.status)">
            {{ formatItemStatus(item.status) }} · r{{ item.revision }}
          </span>
        </div>
        <h1>{{ item.title }}</h1>
        <p>{{ item.description }}</p>
        <dl class="detail-list">
          <div>
            <dt>成色</dt>
            <dd>{{ formatCondition(item.condition) }}</dd>
          </div>
          <div>
            <dt>地点</dt>
            <dd>{{ item.location }}</dd>
          </div>
          <div>
            <dt>发布时间</dt>
            <dd>{{ formatDate(item.created_at) }}</dd>
          </div>
        </dl>
        <UserBrief v-if="owner" :user="owner" />

        <div v-if="lastConflict" class="conflict-box">
          <p>{{ CONFLICT_MESSAGES.stalePage }}</p>
          <ul>
            <li v-for="(change, index) in lastConflict.conflict?.changes ?? []" :key="`${change.id}-${index}`">
              对方改动：{{ formatRemoteChange(change) }}
            </li>
          </ul>
          <div class="pending-card__actions">
            <RouterLink class="primary-button" to="/exchanges">去交换页基于最新数据重试</RouterLink>
            <button class="secondary-button" type="button" @click="lastConflict = null">我知道了</button>
          </div>
        </div>

        <div v-if="!isMine" class="exchange-box">
          <label>
            我的交换物
            <select v-model="selectedItemId">
              <option value="">选择一件我发布的可交换物品</option>
              <option v-for="myItem in ownAvailableItems" :key="myItem.id" :value="myItem.id">
                {{ myItem.title }}（r{{ myItem.revision }}）
              </option>
            </select>
          </label>
          <p v-if="selectedItemMissing" class="field-error">{{ CONFLICT_MESSAGES.exchangedItemLocked }}</p>
          <label>
            留言
            <textarea v-model="messageText" rows="3" />
          </label>
          <button
            class="primary-button"
            type="button"
            :disabled="item.status !== ItemStatus.AVAILABLE || !canSubmit"
            @click="requestExchange"
          >
            发起交换
          </button>
        </div>
        <button v-else-if="item.status === ItemStatus.AVAILABLE" class="secondary-button" type="button" @click="offlineItem">
          下架这件物品
        </button>
      </article>
    </div>
  </section>
  <EmptyState v-else title="物品不存在" description="可能已被清理或链接无效" mark="404" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import EmptyState from '@/components/common/EmptyState.vue';
import ItemImageGallery from '@/components/common/ItemImageGallery.vue';
import UserBrief from '@/components/common/UserBrief.vue';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import { CONFLICT_MESSAGES } from '@/constants/messages';
import { useRemoteRefresh } from '@/hooks/useRemoteRefresh';
import type { PendingBatch } from '@/types';
import { useAuthStore } from '@/stores/authStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { formatCondition, formatDate, formatItemStatus, formatRemoteChange, statusToneClass } from '@/utils/formatters';
import { message } from '@/utils/message';
import { exchangeExpectedRefs } from '@/utils/revisionHelpers';

const route = useRoute();
const itemStore = useItemStore();
const authStore = useAuthStore();
const exchangeStore = useExchangeStore();

useRemoteRefresh();

const item = computed(() => itemStore.items.find((entry) => entry.id === route.params.id));
const owner = computed(() => authStore.users.find((user) => user.id === item.value?.user_id));
const isMine = computed(() => authStore.currentUser?.id === item.value?.user_id);
const ownAvailableItems = computed(() =>
  authStore.currentUser ? itemStore.availableMyItems(authStore.currentUser.id) : [],
);
const selectedItemId = ref('');
const messageText = ref('我想用这件闲置与你交换，可以沟通时间和地点。');
const lastConflict = ref<PendingBatch | null>(null);

const selectedItem = computed(() => itemStore.items.find((entry) => entry.id === selectedItemId.value));
// 曾选中的物品在另一标签页被换出/下架时，保留输入并提示，不再允许直接发起
const selectedItemMissing = computed(
  () => Boolean(selectedItemId.value) && (!selectedItem.value || selectedItem.value.status !== ItemStatus.AVAILABLE),
);
const canSubmit = computed(() => Boolean(selectedItem.value && !selectedItemMissing.value));

const requestExchange = async () => {
  if (!authStore.currentUser || !item.value || !owner.value) return;
  if (!itemStore.assertCanExchange(authStore.currentUser.id)) return;
  if (!selectedItem.value) {
    message('请选择一件自己的物品', 'error');
    return;
  }
  if (item.value.status !== ItemStatus.AVAILABLE) {
    message(CONFLICT_MESSAGES.exchangedItemLocked, 'error');
    return;
  }
  // 提交瞬间抓取两侧物品的最新修订信息，随批次一起发送
  const refs = exchangeExpectedRefs(selectedItem.value, item.value);
  const outcome = await exchangeStore.create(
    {
      from_user_id: authStore.currentUser.id,
      to_user_id: owner.value.id,
      from_item_id: selectedItem.value.id,
      to_item_id: item.value.id,
      status: ExchangeStatus.PENDING,
      message: messageText.value,
    },
    refs,
  );
  const ok = outcome.ok;
  if (ok) {
    selectedItemId.value = '';
    lastConflict.value = null;
  } else if (outcome.batch) {
    // 页面落后：保留 selectedItemId 与 messageText，列出对方改动，待用户基于新数据重做
    lastConflict.value = outcome.batch;
  }
};

const offlineItem = async () => {
  if (!item.value) return;
  const result = await itemStore.offline(item.value);
  if (!result.ok && result.batch) {
    lastConflict.value = result.batch;
  }
};
</script>
