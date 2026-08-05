<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../../../lib/http.js';
import { useToastStore } from '../../../stores/toast.js';

const { showToast } = useToastStore();

const loading = ref(true);
const saving = ref(false);

const form = ref({
  HOSTS: [],
  protocols: ['vless'],
  transports: ['websocket'],
  nodeParams: {
    Fingerprint: 'chrome',
    随机路径: false,
    启用0RTT: false,
    TLS分片: '',
    节点数量: 16,
    优选IP: { 模式: 'optimized', 运营商: 'auto', 随机端口: false, 自定义IP源: '', 优选网站URL: '' },
  },
  ECH: false,
  ECHConfig: { dns: 'https://odvr.nic.cz/doh', domain: 'cloudflare-ech.com' },
  反代: { 模式: '', PROXYIP: '', SOCKS5: { 账号: '' } },
});

const hostsText = ref('');

async function load() {
  loading.value = true;
  try {
    const data = await api.get('/api/node-config');
    const d = data?.data || {};
    form.value = {
      HOSTS: d.HOSTS || [],
      protocols: d.protocols || ['vless'],
      transports: d.transports || ['websocket'],
      nodeParams: {
        Fingerprint: d.nodeParams?.Fingerprint || d.nodeParams?.fingerprint || 'chrome',
        随机路径: Boolean(d.nodeParams?.['随机路径']),
        启用0RTT: Boolean(d.nodeParams?.['启用0RTT']),
        TLS分片: d.nodeParams?.['TLS分片'] || '',
        节点数量: d.nodeParams?.节点数量 || 16,
        优选IP: {
          模式: d.nodeParams?.优选IP?.模式 || 'optimized',
          运营商: d.nodeParams?.优选IP?.运营商 || 'auto',
          随机端口: Boolean(d.nodeParams?.优选IP?.随机端口),
          自定义IP源: d.nodeParams?.优选IP?.自定义IP源 || '',
          优选网站URL: d.nodeParams?.优选IP?.优选网站URL || '',
        },
      },
      ECH: Boolean(d.ECH),
      ECHConfig: {
        dns: d.ECHConfig?.dns || 'https://odvr.nic.cz/doh',
        domain: d.ECHConfig?.domain || d.ECHConfig?.sni || 'cloudflare-ech.com',
      },
      反代: {
        模式: d.反代?.模式 || '',
        PROXYIP: d.反代?.PROXYIP || '',
        SOCKS5: { 账号: d.反代?.SOCKS5?.账号 || '' },
      },
    };
    hostsText.value = (d.HOSTS || []).join('\n');
  } catch (e) {
    showToast(e?.message || '加载节点配置失败', 'error');
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const hosts = hostsText.value.split('\n').map((l) => l.trim()).filter(Boolean);
    await api.put('/api/node-config', {
      HOSTS: hosts,
      protocols: form.value.protocols,
      transports: form.value.transports,
      nodeParams: form.value.nodeParams,
      ECH: form.value.ECH,
      ECHConfig: form.value.ECHConfig,
      反代: form.value.反代,
    });
    showToast('节点配置已保存(传输层/订阅立即生效)', 'success');
  } catch (e) {
    showToast(e?.message || '保存失败', 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading" class="text-center p-12 text-gray-500">加载中...</div>

  <div v-else class="space-y-4">
    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-2">域名列表</h3>
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-3">每行一个域名(host/SNI),生成节点时随机分配。地址始终用优选 IP。</p>
      <textarea v-model="hostsText" rows="3"
        class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
        placeholder="520-10086.cc.cd&#10;第二个域名&#10;第三个域名"></textarea>
    </div>

    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">节点参数</h3>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">优选 IP 模式</label>
          <select v-model="form.nodeParams.优选IP.模式"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40">
            <option value="optimized">运营商优选(推荐)</option>
            <option value="random">全频段随机</option>
            <option value="custom">自定义 IP</option>
            <option value="">不启用(用域名)</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">节点数量</label>
          <input v-model.number="form.nodeParams.节点数量" type="number" min="1" max="64"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">指纹</label>
          <select v-model="form.nodeParams.Fingerprint"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40">
            <option value="chrome">chrome</option>
            <option value="firefox">firefox</option>
            <option value="safari">safari</option>
            <option value="random">random</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">TLS 分片</label>
          <select v-model="form.nodeParams.TLS分片"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40">
            <option value="">关闭</option>
            <option value="shadowrocket">Shadowrocket</option>
            <option value="happ">Happ</option>
          </select>
        </div>
        <div v-if="form.nodeParams.优选IP.模式 === 'custom'">
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">自定义 IP 源</label>
          <textarea v-model="form.nodeParams.优选IP.自定义IP源" rows="2"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            placeholder="IP:端口 每行一个,或 URL"></textarea>
        </div>
      </div>

      <div class="mt-4 space-y-3">
        <label class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg cursor-pointer">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">随机路径</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">节点路径附加随机段(迷惑性)</p>
          </div>
          <input v-model="form.nodeParams.随机路径" type="checkbox" class="h-4 w-4 accent-primary-600" />
        </label>
        <label class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg cursor-pointer">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">启用 0RTT(早数据)</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">路径加 ?ed=2560,减少握手延迟</p>
          </div>
          <input v-model="form.nodeParams.启用0RTT" type="checkbox" class="h-4 w-4 accent-primary-600" />
        </label>
        <label class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg cursor-pointer">
          <div>
            <p class="text-sm font-medium text-gray-900 dark:text-white">随机端口</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">端口从 CF 端口池(443/2053/2083...)随机</p>
          </div>
          <input v-model="form.nodeParams.优选IP.随机端口" type="checkbox" class="h-4 w-4 accent-primary-600" />
        </label>
      </div>
    </div>

    <!-- ECH(加密客户端问候) -->
    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <label class="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/10 misub-radius-lg cursor-pointer">
        <div>
          <h3 class="font-semibold text-gray-900 dark:text-white">ECH(加密客户端问候)</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">加密 TLS ClientHello,隐藏 SNI 防封锁</p>
        </div>
        <input v-model="form.ECH" type="checkbox" class="h-4 w-4 accent-primary-600" />
      </label>
      <div v-if="form.ECH" class="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">ECH DNS 服务器</label>
          <input v-model="form.ECHConfig.dns" type="text"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            placeholder="https://odvr.nic.cz/doh" />
        </div>
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">ECH 域名(SNI)</label>
          <input v-model="form.ECHConfig.domain" type="text"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            placeholder="cloudflare-ech.com" />
        </div>
      </div>
    </div>

    <!-- 反代模式 -->
    <div class="bg-white/80 dark:bg-gray-900/60 border border-gray-100/80 dark:border-white/10 misub-radius-lg p-5">
      <h3 class="font-semibold text-gray-900 dark:text-white mb-4">反代模式</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">传输层连接策略:代理 IP / SOCKS5 转发(可选,一般保持关闭)</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">模式</label>
          <select v-model="form.反代.模式"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/40">
            <option value="">关闭</option>
            <option value="proxyip">ProxyIP</option>
            <option value="socks5">SOCKS5</option>
            <option value="auto">Auto(自动检测)</option>
          </select>
        </div>
        <div v-if="form.反代.模式 === 'proxyip' || form.反代.模式 === 'auto'">
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">ProxyIP(IP:端口 或 auto)</label>
          <input v-model="form.反代.PROXYIP" type="text"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            placeholder="auto" />
        </div>
        <div v-if="form.反代.模式 === 'socks5'">
          <label class="block text-xs text-gray-500 dark:text-gray-400 mb-1">SOCKS5 账号(可选)</label>
          <input v-model="form.反代.SOCKS5.账号" type="text"
            class="w-full px-3 py-2 text-sm bg-white dark:bg-gray-900 border border-gray-200 dark:border-white/10 misub-radius-lg text-gray-900 dark:text-white font-mono focus:outline-none focus:ring-2 focus:ring-primary-500/40"
            placeholder="账号:密码@主机:端口" />
        </div>
      </div>
    </div>

    <div class="flex justify-end">
      <button @click="save" :disabled="saving"
        class="px-6 py-2.5 misub-radius-lg text-white text-sm font-medium shadow-sm transition-all flex items-center gap-2 bg-primary-600 hover:bg-primary-700 hover:shadow-md active:scale-95 disabled:opacity-50">
        {{ saving ? '保存中...' : '保存节点配置' }}
      </button>
    </div>
  </div>
</template>
