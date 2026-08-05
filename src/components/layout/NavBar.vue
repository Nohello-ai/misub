<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUIStore } from '../../stores/ui.js';
import { useSessionStore } from '../../stores/session.js';
import { storeToRefs } from 'pinia';
import BaseIcon from '../ui/BaseIcon.vue';
import BrandLogo from './BrandLogo.vue';
import NavActionGroup from './NavActionGroup.vue';
import { MAIN_NAV_ITEMS } from '../../constants/navigation.js';
import { useI18n } from '../../i18n/index.js';

const route = useRoute();
const uiStore = useUIStore();
const sessionStore = useSessionStore();
const { publicConfig, isAdmin } = storeToRefs(sessionStore);
const isPublicEnabled = computed(() => publicConfig.value?.enablePublicPage === true);
const hideBranding = computed(() => publicConfig.value?.customPage?.enabled === true && publicConfig.value?.customPage?.hideBranding === true);
const { t } = useI18n();

defineProps({
  isLoggedIn: Boolean
});

const emit = defineEmits(['logout']);

const navItems = MAIN_NAV_ITEMS;

function isActive(path) {
  if (path === '/') return route.path === '/';
  if (path === '/dashboard') return route.path === '/dashboard';
  return route.path.startsWith(path);
}

// 权限:adminOnly 且当前非管理员 → 锁定(灰色 + 锁,点击无反应)
function isLocked(item) {
  return item.adminOnly === true && !isAdmin.value;
}
</script>

<template>
  <header
    :aria-label="t('nav.top')"
    class="app-nav-bar md:hidden sticky top-0 z-50 flex items-center justify-between px-4 py-2.5 w-full bg-white/90 dark:bg-[#030712]/88 backdrop-blur-xl border-b border-gray-200/60 dark:border-white/10 shadow-sm transition-all duration-300"
  >
    <BrandLogo text-size-class="text-lg" :icon-size="32" />

    <NavActionGroup
      :is-logged-in="isLoggedIn"
      :show-explore="isPublicEnabled"
      :hide-external-repo="hideBranding"
      :with-focus-ring="true"
      rounded-class="rounded-full"
      @toggle-layout="uiStore.toggleLayout()"
      @logout="emit('logout')"
    />
  </header>

  <header
    :aria-label="t('nav.main')"
    class="app-nav-bar hidden md:block sticky top-0 z-50 w-full bg-white/90 dark:bg-[#030712]/88 backdrop-blur-xl border-b border-gray-200/60 dark:border-white/10 transition-all duration-300"
  >
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 md:h-[76px] flex items-center justify-between">
      <div class="shrink-0 pr-5">
        <BrandLogo text-size-class="text-lg" :icon-size="32" />
      </div>

      <nav :aria-label="t('nav.main')" class="nav-tab-shell">
        <template v-for="item in navItems" :key="item.path">
        <router-link
          v-if="!isLocked(item)"
          :to="item.path"
          class="nav-tab group"
          :class="isActive(item.path) ? 'nav-tab-active' : 'nav-tab-inactive'"
        >
          <div v-if="isActive(item.path)" class="nav-tab-active-pill"></div>

          <BaseIcon
            :path="item.iconPath"
            className="relative z-10 h-4 w-4 shrink-0 transition-transform duration-300"
            :class="isActive(item.path) ? 'scale-105' : 'opacity-75 group-hover:opacity-100'"
          />
          <span class="relative z-10">{{ t(item.key) }}</span>
        </router-link>

        <!-- 普通用户:管理项锁定(灰色 + 锁,点击无反应) -->
        <span
          v-else
          class="nav-tab nav-tab-inactive opacity-40 cursor-not-allowed select-none"
          :title="t('nav.locked')"
        >
          <span class="relative z-10 flex items-center gap-1">
            <BaseIcon :path="item.iconPath" className="h-4 w-4 shrink-0" />
            <svg class="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </span>
          <span class="relative z-10">{{ t(item.key) }}</span>
        </span>
        </template>
      </nav>

      <div class="flex items-center pl-5 ml-3 gap-2">
        <NavActionGroup
          :is-logged-in="isLoggedIn"
          :show-explore="isPublicEnabled"
          :hide-external-repo="hideBranding"
          :with-focus-ring="true"
          :show-divider="true"
          rounded-class="rounded-full"
          @toggle-layout="uiStore.toggleLayout()"
          @logout="emit('logout')"
        />
      </div>
    </div>
  </header>

  <nav
    v-if="isLoggedIn"
    :aria-label="t('nav.bottom')"
    class="md:hidden mobile-nav-glass z-[60]"
  >
    <div class="mobile-nav-inner">
      <template v-for="item in navItems" :key="item.path">
      <router-link
        v-if="!isLocked(item)"
        :to="item.path"
        class="nav-mobile-item"
        :class="isActive(item.path) ? 'nav-mobile-item-active' : 'nav-mobile-item-inactive'"
      >
        <span class="nav-mobile-icon-wrap">
          <BaseIcon
            :path="item.iconPath"
            className="w-5 h-5 transition-transform duration-300"
            :class="isActive(item.path) ? 'scale-110' : ''"
          />
        </span>

        <span class="text-[10px] font-medium tracking-tight">{{ t(item.key) }}</span>
      </router-link>

      <!-- 普通用户:管理项锁定 -->
      <span
        v-else
        class="nav-mobile-item nav-mobile-item-inactive opacity-40 cursor-not-allowed select-none"
        :title="t('nav.locked')"
      >
        <span class="nav-mobile-icon-wrap relative">
          <BaseIcon :path="item.iconPath" className="w-5 h-5" />
          <svg class="absolute -bottom-0.5 -right-0.5 h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </span>
        <span class="text-[10px] font-medium tracking-tight">{{ t(item.key) }}</span>
      </span>
      </template>
    </div>
  </nav>
</template>
