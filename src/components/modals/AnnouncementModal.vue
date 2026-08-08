<script setup>
import { ref, watch } from 'vue';
import Modal from '../forms/Modal.vue';
import { api } from '../../lib/http.js';

const props = defineProps({
  show: Boolean,
});

const emit = defineEmits(['update:show']);

const announcements = ref([]);
const loading = ref(false);
const error = ref('');

async function load() {
  if (!props.show) return;
  loading.value = true;
  error.value = '';
  try {
    const res = await api.get('/api/announcements');
    announcements.value = Array.isArray(res?.data?.announcements) ? res.data.announcements : [];
  } catch (e) {
    error.value = e?.message || '加载公告失败';
    announcements.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => props.show, (v) => {
  if (v) load();
});
</script>

<template>
  <Modal :show="show" size="lg" @update:show="emit('update:show', $event)">
    <template #title>
      <span class="text-lg font-bold text-gray-900 dark:text-white">📢 公告</span>
    </template>
    <template #body>
      <div v-if="loading" class="text-center py-10 text-gray-500">加载中...</div>
      <div v-else-if="error" class="text-center py-10 text-red-500">{{ error }}</div>
      <div v-else-if="announcements.length === 0" class="text-center py-10 text-gray-400 dark:text-gray-500">
        暂无公告
      </div>
      <div v-else class="max-h-[55vh] overflow-y-auto space-y-3 pr-1">
        <!-- 最新在上,最旧在下 -->
        <div
          v-for="a in announcements"
          :key="a.id"
          class="border border-gray-100/80 dark:border-white/10 rounded-lg p-4 bg-white/70 dark:bg-gray-900/50"
        >
          <div class="text-xs text-gray-400 dark:text-gray-500 mb-1.5">📅 {{ a.date }}</div>
          <div class="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap leading-relaxed">{{ a.content }}</div>
        </div>
      </div>
    </template>
    <template #footer>
      <button
        @click="emit('update:show', false)"
        class="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-semibold text-sm misub-radius-lg transition-colors"
      >关闭</button>
    </template>
  </Modal>
</template>
