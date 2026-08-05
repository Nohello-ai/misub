<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../lib/http.js';

const loading = ref(true);
const me = ref(null);
const usage = ref(null);

const PLANS = [
  { quotaGB: 220, name: '轻享月包' },
  { quotaGB: 300, name: '畅玩月包' },
  { quotaGB: 500, name: '极速月包' },
  { quotaGB: 0, name: '旗舰无限包' },
];

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

function formatGB(gb) {
  return `${gb} GB`;
}

const currentPlan = computed(() => {
  const quota = Number(usage.value?.quota || 0);
  if (quota === 0) return PLANS[3];
  const quotaGB = quota / 1024 / 1024 / 1024;
  let best = PLANS[0];
  for (const plan of PLANS.slice(0, 3)) {
    if (quotaGB >= plan.quotaGB * 0.95) best = plan;
  }
  return best;
});

const usedBytes = computed(() => Number(usage.value?.total || 0));
const quotaBytes = computed(() => Number(usage.value?.quota || 0));
const remainingBytes = computed(() => (quotaBytes.value > 0 ? Math.max(0, quotaBytes.value - usedBytes.value) : 0));
const percent = computed(() => (quotaBytes.value > 0 ? Math.min(100, (usedBytes.value / quotaBytes.value) * 100) : 0));
const uploadBytes = computed(() => Number(usage.value?.upload || 0));
const downloadBytes = computed(() => Number(usage.value?.download || 0));

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/api/me');
    me.value = data?.user || null;
    usage.value = data?.usage || null;
  } catch (e) {
    if (e?.status === 401) {
      window.location.href = '/login';
      return;
    }
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="pt-0 pb-6 min-h-[calc(100vh-80px)]">
    <div class="mb-4 bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">仪表盘</h1>
      <p v-if="me" class="text-sm text-gray-500 dark:text-gray-400 mt-1">欢迎,{{ me.username }}</p>
    </div>

    <div v-if="loading" class="text-center p-12 text-gray-500">加载中...</div>

    <div v-else class="space-y-4 max-w-3xl">
      <!-- 套餐类型 -->
      <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">当前套餐</p>
        <div class="flex items-center gap-3">
          <span class="text-2xl font-bold text-gray-900 dark:text-white">{{ currentPlan.name }}</span>
          <span v-if="quotaBytes > 0"
            class="px-2.5 py-0.5 text-xs misub-radius-pill bg-primary-50 text-primary-600 dark:bg-primary-500/15 dark:text-primary-300 font-medium">
            {{ formatGB(currentPlan.quotaGB) }}
          </span>
          <span v-else
            class="px-2.5 py-0.5 text-xs misub-radius-pill bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 font-medium">
            无限流量
          </span>
        </div>
      </div>

      <!-- 上行/下行流量 -->
      <div class="grid grid-cols-2 gap-4">
        <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-4 h-4 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" /></svg>
            <p class="text-sm text-gray-500 dark:text-gray-400">上行流量</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ formatBytes(uploadBytes) }}</p>
        </div>
        <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" /></svg>
            <p class="text-sm text-gray-500 dark:text-gray-400">下行流量</p>
          </div>
          <p class="text-xl font-bold text-gray-900 dark:text-white">{{ formatBytes(downloadBytes) }}</p>
        </div>
      </div>

      <!-- 剩余/总流量进度条 -->
      <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
        <div class="flex items-center justify-between mb-3">
          <p class="text-sm text-gray-500 dark:text-gray-400">剩余流量</p>
          <p class="text-sm font-medium text-gray-900 dark:text-white">
            {{ formatBytes(remainingBytes) }}
            <span class="text-gray-400 dark:text-gray-500">/ {{ quotaBytes > 0 ? formatBytes(quotaBytes) : '无限' }}</span>
          </p>
        </div>
        <div class="h-3 bg-gray-100 dark:bg-white/10 misub-radius-pill overflow-hidden">
          <div class="h-full misub-radius-pill bg-gradient-to-r from-primary-500 via-sky-400 to-emerald-400 transition-all duration-500"
            :style="{ width: `${quotaBytes > 0 ? Math.max(1, percent) : 100}%` }"></div>
        </div>
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2">
          已用 {{ formatBytes(usedBytes) }}
          <span v-if="quotaBytes > 0">({{ percent.toFixed(1) }}%)</span>
        </p>
      </div>
    </div>
  </div>
</template>
