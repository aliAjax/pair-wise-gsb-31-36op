<template>
  <van-config-provider :theme="vantTheme">
    <GlobalErrorBoundary>
      <div class="app-shell">
        <header class="topbar">
          <RouterLink class="brand" to="/home">
            <span>ReSwap</span>
            <small>物尽其用</small>
          </RouterLink>
          <nav>
            <RouterLink to="/home">首页</RouterLink>
            <RouterLink to="/publish">发布</RouterLink>
            <RouterLink to="/exchanges">交换</RouterLink>
            <RouterLink to="/profile">我的</RouterLink>
          </nav>
          <button class="theme-toggle" type="button" @click="themeStore.toggle">
            {{ themeStore.token.label }}
          </button>
        </header>
        <main>
          <RouterView />
        </main>
      </div>
    </GlobalErrorBoundary>
  </van-config-provider>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import { ConfigProvider as VanConfigProvider } from 'vant';

import GlobalErrorBoundary from '@/components/common/GlobalErrorBoundary';
import { LOG_MESSAGES } from '@/constants/messages';
import { useStorageSync } from '@/hooks/useStorageSync';
import { useAuthStore } from '@/stores/authStore';
import { useCommitStore } from '@/stores/commitStore';
import { useExchangeStore } from '@/stores/exchangeStore';
import { useItemStore } from '@/stores/itemStore';
import { useThemeStore } from '@/stores/themeStore';
import { storage } from '@/utils/storage';
import { toVantTheme } from '@/utils/themeUtils';

const authStore = useAuthStore();
const itemStore = useItemStore();
const exchangeStore = useExchangeStore();
const commitStore = useCommitStore();
const themeStore = useThemeStore();
const vantTheme = computed(() => toVantTheme(themeStore.theme));

// 全局监听其他标签页写入，所有页面以存储中的最新有效版本为准
useStorageSync();

onMounted(async () => {
  themeStore.hydrate();
  // 旧版本数据先迁移并补齐修订号，再让任何页面读取
  await storage.migrate();
  await Promise.all([authStore.hydrate(), itemStore.hydrate(), exchangeStore.hydrate()]);
  // 恢复上次崩溃/关页留下的可重试批次
  await commitStore.recoverPending(false);
  if (import.meta.env.DEV) {
    console.debug(LOG_MESSAGES.storageMigrated);
  }
});
</script>
