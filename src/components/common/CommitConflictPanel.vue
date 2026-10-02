<template>
  <div class="conflict-panel" role="alert">
    <strong>{{ title }}</strong>
    <p>{{ hint }}</p>
    <ul>
      <li v-for="(line, index) in lines" :key="`${line}-${index}`">
        <span>{{ line }}</span>
      </li>
    </ul>
    <div v-if="$slots.actions" class="conflict-panel__actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { PAGE_MESSAGES } from '@/constants/messages';
import type { ConflictDetail } from '@/models/commitBatch';
import { formatConflictLine } from '@/utils/formatters';

const props = withDefaults(
  defineProps<{
    conflicts: ConflictDetail[];
    title?: string;
    hint?: string;
  }>(),
  {
    title: PAGE_MESSAGES.staleSubmitTitle,
    hint: PAGE_MESSAGES.staleSubmitHint,
  },
);

const lines = computed(() => props.conflicts.map(formatConflictLine));
</script>
