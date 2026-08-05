<script setup>
import { ref, computed, onMounted } from 'vue';
import { api } from '../lib/http.js';
import { useI18n } from '../i18n/index.js';
import { useToastStore } from '../stores/toast.js';
import { useSessionStore } from '../stores/session.js';
import { storeToRefs } from 'pinia';

const { t } = useI18n();
const { showToast } = useToastStore();
const sessionStore = useSessionStore();
const { isAdmin } = storeToRefs(sessionStore);

const users = ref([]);
const loading = ref(true);
const saving = ref(false);
const showModal = ref(false);
const editing = ref(null);
const form = ref({ username: '', password: '', quotaBytes: '', role: 'user', disabled: false });
const filter = ref('');

const filteredUsers = computed(() => {
  if (!filter.value) return users.value;
  const q = filter.value.toLowerCase();
  return users.value.filter(u => u.username.toLowerCase().includes(q));
});

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

async function loadUsers() {
  loading.value = true;
  try {
    const data = await api.get('/api/useradmin/users');
    users.value = data?.users || [];
  } catch (e) {
    showToast(e?.message || '加载用户失败', 'error');
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = { username: '', password: '', quotaBytes: '', role: 'user', disabled: false };
  showModal.value = true;
}

function openEdit(user) {
  editing.value = user;
  form.value = {
    username: user.username, password: '',
    quotaBytes: user.quotaBytes ?? '', role: user.role || 'user', disabled: Boolean(user.disabled),
  };
  showModal.value = true;
}

async function saveUser() {
  if (!form.value.username || (editing.value ? false : !form.value.password)) {
    showToast('用户名和密码必填', 'error');
    return;
  }
  saving.value = true;
  try {
    const payload = { ...form.value, quotaBytes: form.value.quotaBytes === '' ? 0 : Number(form.value.quotaBytes) };
    if (editing.value) {
      if (!payload.password) delete payload.password;
      await api.patch(`/api/useradmin/users/${editing.value.userID}`, payload);
    } else {
      await api.post('/api/useradmin/users', payload);
    }
    showToast(editing.value ? '已更新用户' : '已创建用户', 'success');
    showModal.value = false;
    await loadUsers();
  } catch (e) {
    showToast(e?.message || '保存失败', 'error');
  } finally {
    saving.value = false;
  }
}

async function toggleDisabled(user) {
  try {
    await api.patch(`/api/useradmin/users/${user.userID}`, { disabled: !user.disabled });
    await loadUsers();
  } catch (e) {
    showToast(e?.message || '操作失败', 'error');
  }
}

async function deleteUser(user) {
  if (!window.confirm(`确认删除用户 ${user.username}？`)) return;
  try {
    await api.del(`/api/useradmin/users/${user.userID}`);
    showToast('已删除用户', 'success');
    await loadUsers();
  } catch (e) {
    showToast(e?.message || '删除失败', 'error');
  }
}

onMounted(loadUsers);
</script>

<template>
  <!-- 普通用户:锁定页(灰色 + 锁,无法绕过) -->
  <div v-if="!isAdmin" class="pt-0 pb-6 min-h-[calc(100vh-80px)] flex items-center justify-center">
    <div class="text-center max-w-sm mx-auto p-10 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg opacity-70 select-none">
      <svg class="w-12 h-12 mx-auto text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
      <h2 class="text-lg font-bold text-gray-500 dark:text-gray-400">仅管理员可用</h2>
      <p class="text-sm text-gray-400 dark:text-gray-500 mt-2">该功能仅限管理员访问</p>
    </div>
  </div>

  <div v-else class="pt-0 pb-6 min-h-[calc(100vh-80px)]">
    <div class="mb-4 bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-gray-900 dark:text-white">用户管理</h1>
      <button @click="openCreate"
        class="px-4 py-2 misub-radius-lg text-white text-sm font-medium shadow-sm transition-all flex items-center gap-2 bg-primary-600 hover:bg-primary-700 hover:shadow-md active:scale-95">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        添加用户
      </button>
    </div>

    <div class="mb-4">
      <input v-model="filter" placeholder="搜索用户名..."
        class="w-full md:w-72 px-3 py-2 text-sm bg-white/80 dark:bg-gray-900/60 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
    </div>

    <div v-if="loading" class="text-center p-12 text-gray-500">加载中...</div>

    <div v-else-if="filteredUsers.length === 0" class="text-center p-12 text-gray-500">暂无用户</div>

    <div v-else class="space-y-3">
      <div v-for="user in filteredUsers" :key="user.userID"
        class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-4 flex flex-col md:flex-row md:items-center gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold text-gray-900 dark:text-white truncate">{{ user.username }}</span>
            <span v-if="user.role === 'admin'"
              class="px-2 py-0.5 text-xs misub-radius-pill bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">管理员</span>
            <span v-else
              class="px-2 py-0.5 text-xs misub-radius-pill bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300">用户</span>
            <span v-if="user.disabled"
              class="px-2 py-0.5 text-xs misub-radius-pill bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">已禁用</span>
          </div>
          <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            用量 {{ formatBytes(user.usage?.total || 0) }} / 配额 {{ formatBytes(user.usage?.quota || user.quotaBytes) }}
            <span v-if="user.usage?.quota > 0" class="ml-1">
              (剩余 {{ formatBytes(user.usage?.remaining) }})
            </span>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button @click="openEdit(user)"
            class="px-3 py-1.5 text-xs misub-radius-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/15">编辑</button>
          <button @click="toggleDisabled(user)"
            class="px-3 py-1.5 text-xs misub-radius-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/15">
            {{ user.disabled ? '启用' : '禁用' }}
          </button>
          <button @click="deleteUser(user)"
            class="px-3 py-1.5 text-xs misub-radius-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-500/20">删除</button>
        </div>
      </div>
    </div>

    <!-- 添加/编辑弹窗 -->
    <div v-if="showModal" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      @click.self="showModal = false">
      <div class="w-full max-w-md bg-white dark:bg-gray-900 misub-radius-lg p-6 shadow-xl border border-gray-100 dark:border-white/10">
        <h2 class="text-lg font-bold text-gray-900 dark:text-white mb-4">{{ editing ? '编辑用户' : '添加用户' }}</h2>
        <div class="space-y-4">
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">用户名</label>
            <input v-model="form.username" :disabled="!!editing"
              class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40 disabled:opacity-50" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">密码{{ editing ? '(留空则不修改)' : '' }}</label>
            <input v-model="form.password" type="password" autocomplete="new-password"
              class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">配额 (GB, 0 = 无限)</label>
            <input v-model="form.quotaBytes" type="number" min="0" step="1"
              class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
          </div>
          <div>
            <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">角色</label>
            <select v-model="form.role"
              class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40">
              <option value="user">普通用户</option>
              <option value="admin">管理员</option>
            </select>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button @click="showModal = false"
            class="px-4 py-2 text-sm misub-radius-lg bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-200">取消</button>
          <button @click="saveUser" :disabled="saving"
            class="px-4 py-2 text-sm misub-radius-lg text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
