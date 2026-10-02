<template>
  <section v-if="item" class="page detail-page">
    <RouterLink class="text-link" to="/home">返回首页</RouterLink>
    <div class="detail-layout">
      <ItemImageGallery :images="item.images" :fallback-text="item.category" />
      <article class="detail-panel">
        <div class="item-card__topline">
          <span class="pill">{{ item.category }}</span>
          <span class="status-pill" :class="statusToneClass(item.status)">
            {{ formatItemStatus(item.status) }}
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

        <CommitConflictPanel
          v-if="createConflict"
          :conflicts="createConflict.conflicts"
        >
          <template #actions>
            <button class="secondary-button" type="button" @click="commitStore.clearConflict(createScope)">
              我知道了
            </button>
          </template>
        </CommitConflictPanel>

        <div v-if="!isMine" class="exchange-box">
          <label>
            我的交换物
            <select v-model="selectedItemId">
              <option value="">选择一件我发布的可交换物品</option>
              <option v-for="myItem in ownAvailableItems" :key="myItem.id" :value="myItem.id">
                {{ myItem.title }}
              </option>
            </select>
          </label>
          <label>
            留言
            <textarea v-model="messageText" rows="3" />
          </label>
          <button
            class="primary-button"
            type="button"
            :disabled="item.status !== ItemStatus.AVAILABLE || commitStore.busy"
            @click="requestExchange"
          >
            {{ item.status === ItemStatus.AVAILABLE ? '发起交换' : formatStatusMessage(item.status) }}
          </button>
        </div>

        <template v-else>
          <CommitConflictPanel
            v-if="offlineConflict"
            :conflicts="offlineConflict.conflicts"
          >
            <template #actions>
              <button class="secondary-button" type="button" @click="commitStore.clearConflict(offlineScope)">
                我知道了
              </button>
            </template>
          </CommitConflictPanel>
          <button
            v-if="item.status === ItemStatus.AVAILABLE"
            class="secondary-button"
            type="button"
            :disabled="commitStore.busy"
            @click="offlineItem"
          >
            下架这件物品
          </button>
          <p v-else class="form-note">{{ formatStatusMessage(item.status) }}</p>
        </template>
      </article>
    </div>
  </section>
  <EmptyState v-else title="物品不存在" description="可能已被清理或链接无效" mark="404" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink, useRoute } from 'vue-router';

import CommitConflictPanel from '@/components/common/CommitConflictPanel.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import ItemImageGallery from '@/components/common/ItemImageGallery.vue';
import UserBrief from '@/components/common/UserBrief.vue';
import { ExchangeStatus } from '@/constants/exchange';
import { ItemStatus } from '@/constants/item';
import { useStorageSync } from '@/hooks/useStorageSync';
import { useAuthStore } from '@/stores/authStore';
import { useCommitStore } from '@/stores/commitStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import {
  formatCondition,
  formatDate,
  formatItemStatus,
  formatStatusMessage,
  statusToneClass,
} from '@/utils/formatters';
import { message } from '@/utils/message';

const route = useRoute();
const itemStore = useItemStore();
const authStore = useAuthStore();
const exchangeStore = useExchangeStore();
const commitStore = useCommitStore();

useStorageSync();

const item = computed(() => itemStore.items.find((entry) => entry.id === route.params.id));
const owner = computed(() => authStore.users.find((user) => user.id === item.value?.user_id));
const isMine = computed(() => authStore.currentUser?.id === item.value?.user_id);
const ownAvailableItems = computed(() =>
  authStore.currentUser ? itemStore.availableMyItems(authStore.currentUser.id) : [],
);
const selectedItemId = ref('');
const messageText = ref('我想用这件闲置与你交换，可以沟通时间和地点。');

const createScope = computed(() => `item:create:${route.params.id as string}`);
const offlineScope = computed(() => `item:${route.params.id as string}`);
const createConflict = computed(() => commitStore.conflictOf(createScope.value));
const offlineConflict = computed(() => commitStore.conflictOf(offlineScope.value));

const requestExchange = async () => {
  if (!authStore.currentUser || !item.value || !owner.value) return;
  if (!itemStore.assertCanExchange(authStore.currentUser.id)) return;
  if (!selectedItemId.value) {
    message('请选择一件自己的物品', 'error');
    return;
  }
  const ownItem = itemStore.items.find((entry) => entry.id === selectedItemId.value);
  if (!ownItem || ownItem.status !== ItemStatus.AVAILABLE) {
    message('这件物品当前不可交换，请重新选择', 'error');
    return;
  }
  // 修订号取自最新 hydrate 结果；提交失败时不跳转、不清空，等用户基于新数据重试
  const ok = await exchangeStore.create(
    {
      from_user_id: authStore.currentUser.id,
      to_user_id: owner.value.id,
      from_item_id: selectedItemId.value,
      to_item_id: item.value.id,
      status: ExchangeStatus.PENDING,
      message: messageText.value,
    },
    {
      fromItemRevision: ownItem.revision,
      toItemRevision: item.value.revision,
    },
    createScope.value,
  );
  if (ok) {
    selectedItemId.value = '';
    messageText.value = '我想用这件闲置与你交换，可以沟通时间和地点。';
  }
};

const offlineItem = async () => {
  if (!item.value) return;
  // 下架批次要带上引用本物品的待确认交换，连同物品一起原子拒绝
  const pendingExchanges = exchangeStore.exchanges
    .filter(
      (exchange) =>
        exchange.status === ExchangeStatus.PENDING &&
        (exchange.from_item_id === item.value!.id || exchange.to_item_id === item.value!.id),
    )
    .map((exchange) => ({ id: exchange.id, revision: exchange.revision }));
  await itemStore.offline(item.value.id, item.value.revision, pendingExchanges, offlineScope.value);
};
</script>
