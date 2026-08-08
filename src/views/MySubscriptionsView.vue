<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../lib/http.js';
import { useToastStore } from '../stores/toast.js';
import QRCode from 'qrcode';

const { showToast } = useToastStore();

const loading = ref(true);
const me = ref(null);
const subUrl = ref('');
const copied = ref(false);
const showQr = ref(false);
const qrDataUrl = ref('');
const activeType = ref('clash');
const showTypeModal = ref(false);

// 订阅类型列表(原版内置生成器支持)
const types = [
  { id: 'clash', name: 'Clash', desc: 'Clash / Mihomo' },
  { id: 'singbox', name: 'Sing-Box', desc: '跨平台新一代' },
  { id: 'v2ray', name: 'Base64 通用', desc: 'v2rayN / 通用客户端' },
  { id: 'surge', name: 'Surge', desc: 'macOS / iOS' },
  { id: 'loon', name: 'Loon', desc: 'iOS 专用' },
  { id: 'quanx', name: 'Quantumult X', desc: 'iOS 专用' },
];

const currentType = ref(types[0]);

function buildUrl(profileToken, profileId, target) {
  const origin = window.location.origin;
  return `${origin}/${profileToken}/${profileId}?target=${target}`;
}

function selectType(type) {
  activeType.value = type.id;
  currentType.value = type;
  showTypeModal.value = false;
  refreshUrl();
}

function refreshUrl() {
  // subUrl 存的是 base(不带 target),刷新时按当前类型拼
  const base = subUrl.value.split('?')[0];
  subUrl.value = `${base}?target=${activeType.value}`;
}

async function load() {
  loading.value = true;
  try {
    const meData = await api.get('/api/me');
    me.value = meData?.user || null;
    const sub = meData?.subscription;
    if (sub?.profileToken && sub?.profileId) {
      subUrl.value = buildUrl(sub.profileToken, sub.profileId, activeType.value);
    } else {
      showToast('订阅尚未初始化,请稍后刷新', 'error');
    }
  } catch (e) {
    if (e?.status === 401) {
      window.location.href = '/login';
      return;
    }
    showToast(e?.message || '加载失败', 'error');
  } finally {
    loading.value = false;
  }
}

async function copyUrl() {
  try {
    await navigator.clipboard.writeText(subUrl.value);
    copied.value = true;
    showToast('订阅链接已复制', 'success');
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    showToast('复制失败,请手动复制', 'error');
  }
}

async function showQrCode() {
  if (!subUrl.value) return;
  try {
    qrDataUrl.value = await QRCode.toDataURL(subUrl.value, { width: 280, margin: 1 });
    showQr.value = true;
  } catch {
    showToast('二维码生成失败', 'error');
  }
}

onMounted(load);
</script>

<template>
  <div class="pt-0 pb-6 min-h-[calc(100vh-80px)]">
    <div class="mb-4 bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">我的订阅</h1>
      <p v-if="me" class="text-sm text-gray-500 dark:text-gray-400 mt-1">当前用户:{{ me.username }}</p>
    </div>

    <div v-if="loading" class="text-center p-12 text-gray-500">加载中...</div>

    <div v-else class="space-y-4 max-w-2xl">
      <!-- 订阅类型(单个按钮,弹窗选择) -->
      <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">订阅类型</p>
        <button @click="showTypeModal = true"
          class="w-full flex items-center justify-between px-4 py-3 misub-radius-lg bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-left transition-all hover:bg-gray-50 dark:hover:bg-white/10">
          <span>
            <span class="block text-sm font-medium text-gray-900 dark:text-white">{{ currentType.name }}</span>
            <span class="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ currentType.desc }}</span>
          </span>
          <svg class="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </button>
      </div>

      <!-- 订阅链接 -->
      <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-semibold text-gray-900 dark:text-white">订阅链接</h3>
          <div class="flex items-center gap-2">
            <button @click="copyUrl"
              class="px-3 py-1.5 text-xs misub-radius-lg text-white bg-primary-600 hover:bg-primary-700 flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
              {{ copied ? '已复制' : '复制' }}
            </button>
            <button @click="showQrCode" title="生成二维码"
              class="px-3 py-1.5 text-xs misub-radius-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/15 flex items-center gap-1">
              <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h.01M5 20H4a1 1 0 01-1-1v-1m0-4v-3m0-4V5a1 1 0 011-1h1m4 0h3m4 0h1a1 1 0 011 1v1" /></svg>
              二维码
            </button>
          </div>
        </div>
        <div class="bg-muted rounded-lg px-3 py-2.5 text-xs font-mono text-muted-foreground break-all select-all">
          {{ subUrl }}
        </div>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">该链接免登录,客户端可直接导入;请勿泄露给他人</p>
      </div>
    </div>

    <!-- 订阅类型选择弹窗 -->
    <div v-if="showTypeModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="showTypeModal = false">
      <div class="bg-white dark:bg-gray-900 misub-radius-lg p-6 shadow-xl border border-gray-100 dark:border-white/10 max-w-sm w-full">
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">选择订阅类型</h3>
        <div class="space-y-2">
          <button v-for="t in types" :key="t.id" @click="selectType(t)"
            class="w-full p-3 misub-radius-lg border text-left transition-all"
            :class="activeType === t.id
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/10'">
            <p class="text-sm font-medium">{{ t.name }}</p>
            <p class="text-xs opacity-70 mt-0.5">{{ t.desc }}</p>
          </button>
        </div>
        <div class="mt-5 flex justify-end">
          <button @click="showTypeModal = false"
            class="px-4 py-2 text-sm misub-radius-lg text-white bg-primary-600 hover:bg-primary-700">确定</button>
        </div>
      </div>
    </div>

    <!-- 二维码弹窗 -->
    <div v-if="showQr" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" @click.self="showQr = false">
      <div class="bg-white dark:bg-gray-900 misub-radius-lg p-6 shadow-xl border border-gray-100 dark:border-white/10 text-center">
        <h3 class="text-lg font-bold text-gray-900 dark:text-white mb-4">订阅二维码</h3>
        <img v-if="qrDataUrl" :src="qrDataUrl" alt="订阅二维码" class="mx-auto w-64 h-64" />
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-3 break-all max-w-xs mx-auto">{{ subUrl }}</p>
        <button @click="showQr = false"
          class="mt-4 px-4 py-2 text-sm misub-radius-lg text-white bg-primary-600 hover:bg-primary-700">关闭</button>
      </div>
    </div>
  </div>
</template>
