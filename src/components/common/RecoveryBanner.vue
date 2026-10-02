<template>
  <div v-for="batch in batches" :key="batch.id" class="recovery-banner" role="status">
    <div>
      <strong>{{ commitStore.actionLabel(batch.kind) }} · {{ batch.id }}</strong>
      <p>{{ PAGE_MESSAGES.pendingBatchHint }}</p>
      <CommitConflictPanel
        v-if="batch.conflicts.length"
        :conflicts="batch.conflicts"
        title="恢复时发现数据已被修改"
        hint="这笔提交基于旧修订号，无法继续，请放弃后按最新数据重新操作。"
      />
    </div>
    <div class="recovery-banner__actions">
      <button v-if="batch.status === CommitBatchStatus.PENDING" type="button" @click="$emit('retry', batch.id)">
        重试提交
      </button>
      <button type="button" @click="$emit('discard', batch.id)">
        {{ batch.status === CommitBatchStatus.PENDING ? '放弃批次' : '清除提示' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CommitBatchStatus } from '@/constants/commit';
import { PAGE_MESSAGES } from '@/constants/messages';
import type { CommitBatch } from '@/models/commitBatch';
import { useCommitStore } from '@/stores/commitStore';

import CommitConflictPanel from './CommitConflictPanel.vue';

defineProps<{
  batches: CommitBatch[];
}>();

defineEmits<{
  retry: [id: string];
  discard: [id: string];
}>();

const commitStore = useCommitStore();
</script>