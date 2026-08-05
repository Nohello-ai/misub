<script setup>
defineProps({
  settings: { type: Object, default: () => ({}) }
});
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-2">订阅管理</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">
        在「机场订阅」页面管理上游订阅源。添加您的节点订阅链接后，即可在「我的订阅」中生成多格式订阅。
      </p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg p-4">
          <p class="text-xs text-gray-500 dark:text-gray-400">步骤 1</p>
          <p class="text-sm font-medium text-gray-900 dark:text-white mt-1">添加上游订阅</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">进入「机场订阅」添加订阅链接</p>
        </div>
        <div class="bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg p-4">
          <p class="text-xs text-gray-500 dark:text-gray-400">步骤 2</p>
          <p class="text-sm font-medium text-gray-900 dark:text-white mt-1">创建订阅分组</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">组合多个订阅源，按场景分组</p>
        </div>
        <div class="bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg p-4">
          <p class="text-xs text-gray-500 dark:text-gray-400">步骤 3</p>
          <p class="text-sm font-medium text-gray-900 dark:text-white mt-1">生成订阅链接</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Clash / Sing-Box / Surge 等全格式</p>
        </div>
      </div>
    </div>

    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-2">流量显示</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        订阅输出会自动透传上游的剩余流量信息(Subscription-Userinfo)。
        客户端(Clash / Mihomo 等)订阅页即可显示剩余流量与到期时间。
      </p>
    </div>
  </div>
</template>
