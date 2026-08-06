/**
 * MiSub 拼节点引擎(独立文件)
 *
 * 职责:从共享 KV 读全局节点参数 + 识别运营商 + 生成优选 IP + 组装 vless/trojan 节点。
 * 传输层/用户管理层都不知道节点参数,全部由这里拼接。
 *
 * 数据源:
 *   - 节点参数:共享 KV(与传输层共用,key = global_config)
 *   - 用户数据:调用方传入(UUID/配额,来自用户管理层 API)
 */

// ── 常量 ─────────────────────────────────────────────
export const CF_PORTS = Object.freeze([443, 2053, 2083, 2087, 2096, 8443]);

const OPERATOR_LABEL = Object.freeze({
  cmcc: '中国移动优选',
  ct: '中国电信优选',
  cu: '中国联通优选',
  cf: '国际优选',
});

const OPERATOR_CIDR = Object.freeze({
  ct: 'CF-CIDR/ct.txt',
  cu: 'CF-CIDR/cu.txt',
  cmcc: 'CF-CIDR/cmcc.txt',
  cf: 'CF-CIDR.txt',
});

const GITHUB_RAW = 'https://raw.githubusercontent.com/cmliu/cmliu/main';

const FALLBACK_CIDRS = Object.freeze(['104.16.0.0/13', '172.64.0.0/13', '162.158.0.0/15', '198.41.128.0/17']);

const TRANSPORTS = Object.freeze({
  websocket: Object.freeze({ type: 'ws', hostKey: 'host', pathKey: 'path' }),
  ws: Object.freeze({ type: 'ws', hostKey: 'host', pathKey: 'path' }),
  grpc: Object.freeze({ type: 'grpc', hostKey: 'authority', pathKey: 'serviceName' }),
  xhttp: Object.freeze({ type: 'xhttp', hostKey: 'host', pathKey: 'path' }),
});

const TLS_FRAGMENT_PRESETS = Object.freeze({
  shadowrocket: '1,40-60,30-50,tlshello',
  happ: '3,1,tlshello',
});

const ASN_MAP = {
  '4134': 'ct', '4809': 'ct', '4811': 'ct', '4812': 'ct', '4815': 'ct',
  '4837': 'cu', '4814': 'cu', '9929': 'cu', '17623': 'cu', '17816': 'cu',
  '9808': 'cmcc', '24400': 'cmcc', '56040': 'cmcc', '56041': 'cmcc', '56044': 'cmcc',
};

const KEYWORD_RULES = [
  { code: 'ct', pattern: /chinanet|chinatelecom|china telecom|cn2|shtel/ },
  { code: 'cmcc', pattern: /cmi|cmnet|chinamobile|china mobile|cmcc|mobile communications/ },
  { code: 'cu', pattern: /china169|china unicom|chinaunicom|cucc|cncgroup|cuii|netcom/ },
];

// ── 配置读取(共享 KV)─────────────────────────────────
/** 读共享 KV 的全局配置(节点参数/域名/反代等) */
export async function loadNodeConfig(env) {
  const kv = env?.SHARED_KV || env?.KV;
  if (!kv) return {};
  try {
    const raw = await kv.get('global_config', 'text');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** 保存全局配置到共享 KV */
export async function saveNodeConfig(env, config) {
  const kv = env?.SHARED_KV || env?.KV;
  if (!kv) return false;
  await kv.put('global_config', JSON.stringify(config));
  return true;
}

// ── 运营商识别(request.cf)────────────────────────────
export function identifyOperator(cf) {
  if (!cf || typeof cf !== 'object') return 'cf';
  if (String(cf.country || '').toLowerCase() !== 'cn') return 'cf';
  const org = String(cf.asOrganization || '').toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(org)) return rule.code;
  }
  return ASN_MAP[String(cf.asn || '')] || 'cf';
}

export function operatorLabel(operator) {
  return OPERATOR_LABEL[operator] || OPERATOR_LABEL.cf;
}

// ── CIDR 拉取(运营商优选段)───────────────────────────
const cidrCache = new Map();
const CACHE_TTL = 3600_000;

export async function getCIDRList(operator = 'cf') {
  const key = OPERATOR_CIDR[operator];
  const now = Date.now();
  const cached = cidrCache.get(key);
  if (cached && now - cached.timestamp < CACHE_TTL) return cached.cidrs;
  try {
    const res = await fetch(`${GITHUB_RAW}/${key}`);
    if (res.ok) {
      const text = await res.text();
      const cidrs = text.split('\n').map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#') && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(l));
      if (cidrs.length) {
        cidrCache.set(key, { cidrs, timestamp: now });
        return cidrs;
      }
    }
  } catch { /* 兜底 */ }
  return [...FALLBACK_CIDRS];
}

// ── IP 生成 ──────────────────────────────────────────
function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const octet = parseInt(part, 10);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) return null;
    result = (result << 8) | octet;
  }
  return result >>> 0;
}

function intToIP(value) {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.');
}

function randomIPInRange(baseIP, hostBits) {
  if (hostBits <= 0) return intToIP(baseIP);
  const maxOffset = 2 ** hostBits;
  const offset = Math.floor(Math.random() * maxOffset);
  return intToIP((baseIP + offset) >>> 0);
}

function parseCIDR(cidr) {
  const parts = cidr.split('/');
  if (parts.length !== 2) return null;
  const prefix = parseInt(parts[1], 10);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const baseIP = ipToInt(parts[0]);
  if (baseIP == null) return null;
  return { baseIP, hostBits: 32 - prefix };
}

export function generateIPs(cidrs, count, options = {}) {
  if (!Array.isArray(cidrs) || cidrs.length === 0) return [];
  const ports = options.ports || CF_PORTS;
  const results = [];
  for (let i = 0; i < count; i++) {
    const cidr = cidrs[Math.floor(Math.random() * cidrs.length)];
    const range = parseCIDR(cidr);
    if (!range) continue;
    const ip = randomIPInRange(range.baseIP, range.hostBits);
    const port = ports[Math.floor(Math.random() * ports.length)];
    results.push(`${ip}:${port}`);
  }
  return results;
}

function parseIPEntry(text) {
  const m = text.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?$/);
  if (!m) return null;
  const octets = m[1].split('.').map(Number);
  if (octets.some((o) => o < 0 || o > 255)) return null;
  if (m[2]) {
    const port = parseInt(m[2], 10);
    if (port < 1 || port > 65535) return null;
    return { address: m[1], port };
  }
  return { address: m[1], port: null };
}

export function parseCustomIPs(text) {
  if (!text) return null;
  const results = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const hashIndex = trimmed.indexOf('#');
    const ipPart = hashIndex !== -1 ? trimmed.slice(0, hashIndex).trim() : trimmed;
    const entry = parseIPEntry(ipPart);
    if (entry) results.push(entry);
  }
  return results.length ? results : null;
}

export async function fetchCustomIPs(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return parseCustomIPs(await res.text());
  } catch {
    return null;
  }
}

// ── 节点组装(buildNodeURI 逻辑,从 v2 移植)────────────
function formatAddress(address) {
  const value = String(address).trim();
  if (value.includes(':') && !(value.startsWith('[') && value.endsWith(']'))) return `[${value}]`;
  return value;
}

function addQuery(query, source) {
  if (!source) return;
  const entries = source instanceof URLSearchParams
    ? source.entries()
    : typeof source === 'string'
      ? new URLSearchParams(source.replace(/^[?&]+/, '')).entries()
      : Object.entries(source);
  for (const [key, value] of entries) {
    if (value !== undefined && value !== null) query.set(String(key), String(value));
  }
}

export function buildNodeURI(node) {
  const protocol = String(node?.protocol || 'vless').toLowerCase();
  if (protocol !== 'vless' && protocol !== 'trojan') throw new TypeError(`unsupported protocol: ${protocol}`);
  const transportName = String(node?.transport || 'websocket').toLowerCase();
  const transport = TRANSPORTS[transportName];
  if (!transport) throw new TypeError(`unsupported transport: ${transportName}`);
  const credential = protocol === 'vless'
    ? String(node?.credential || node?.uuid || node?.userID || '')
    : String(node?.credential || node?.password || node?.secret || '');
  if (!credential) throw new TypeError('credential is required');
  const address = formatAddress(String(node?.address || node?.server || ''));
  const port = Number(node?.port || 443);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('port invalid');
  const host = String(node?.host || '');
  const sni = String(node?.sni ?? host);
  const security = String(node?.security ?? 'tls');
  const query = new URLSearchParams();
  query.set('security', security);
  query.set('type', transport.type);
  query.set(transport.hostKey, host);
  if (security === 'tls' && sni) query.set('sni', sni);
  const path = String(node?.path || '/');
  query.set(transport.pathKey, path);
  if (protocol === 'vless') query.set('encryption', String(node?.encryption ?? 'none'));
  if (transport.type === 'xhttp' && node?.mode) query.set('mode', String(node.mode));
  if (node?.fingerprint || node?.fp) query.set('fp', String(node.fingerprint ?? node.fp));
  addQuery(query, node?.query);
  const name = String(node?.name ?? `${protocol}-${transportName}-${host}`);
  return `${protocol}://${encodeURIComponent(credential)}@${address}:${port}?${query.toString()}#${encodeURIComponent(name)}`;
}

// ── 节点参数规范化(路径/0RTT/分片/指纹,从 v2 params.js 移植)──
function normalizePath(path) {
  const value = String(path || '/').trim() || '/';
  return value.startsWith('/') ? value : `/${value}`;
}

function asBoolean(value) {
  return value === true || value === 1 || String(value).toLowerCase() === 'true';
}

function randomPathSegment() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function normalizeNodeParams(input = {}) {
  let path = normalizePath(input.path || '/');
  if (asBoolean(input.randomPath ?? input['随机路径'])) {
    path = normalizePath(`${path}/${randomPathSegment()}`);
  }
  const pathUrl = new URL(path, 'https://node.invalid');
  const pathQuery = new URLSearchParams(pathUrl.search);
  if (asBoolean(input.zeroRTT ?? input.enable0RTT ?? input['启用0RTT'])) {
    pathQuery.set('ed', String(input.earlyData ?? 2560));
  }
  if (pathQuery.toString()) {
    path = `${pathUrl.pathname}?${pathQuery.toString()}`;
  }
  const fragmentInput = input.fragment ?? input.tlsFragment ?? input['TLS分片'];
  const preset = TLS_FRAGMENT_PRESETS[String(fragmentInput || '').toLowerCase()];
  const fragment = preset || (fragmentInput && !/^(false|none|off)$/i.test(String(fragmentInput)) ? String(fragmentInput) : null);
  const query = new URLSearchParams();
  if (fragment) query.set('fragment', fragment);
  return { path, query };
}

// ── 优选 IP 决策(从 v2 resolveIPReplacements 移植)─────
async function resolveIPReplacements(optIP, request, nodeCount = 16, operatorOverride = null) {
  const operator = operatorOverride || identifyOperator(request?.cf);
  const randomPort = Boolean(optIP?.随机端口);

  if (optIP?.模式 === 'custom') {
    let entries;
    if (optIP.优选网站URL) {
      entries = await fetchCustomIPs(optIP.优选网站URL);
    } else if (optIP.自定义IP源) {
      entries = /^https?:\/\//i.test(optIP.自定义IP源)
        ? await fetchCustomIPs(optIP.自定义IP源)
        : parseCustomIPs(optIP.自定义IP源);
    }
    if (entries && entries.length) {
      return entries.map((entry, i) => ({
        address: entry.address,
        port: entry.port ?? (randomPort ? CF_PORTS[Math.floor(Math.random() * CF_PORTS.length)] : 443),
        name: `${operatorLabel(operator)}${i + 1}`,
      }));
    }
    const fallback = await getCIDRList('cf');
    const ips = generateIPs(fallback, nodeCount, { ports: randomPort ? undefined : [443] });
    return ips.map((ip, i) => {
      const [address, port] = ip.split(':');
      return { address, port: Number(port), name: `Ip获取失败${i + 1}` };
    });
  }

  const cidrs = optIP?.模式 === 'optimized' ? await getCIDRList(operator) : await getCIDRList('cf');
  if (!cidrs || cidrs.length === 0) return [];
  const ips = generateIPs(cidrs, nodeCount, { ports: randomPort ? undefined : [443] });
  return ips.map((ip, i) => {
    const [address, port] = ip.split(':');
    return { address, port: Number(port), name: `${operatorLabel(operator)}${i + 1}` };
  });
}

// ── 主函数:拼接节点 ──────────────────────────────────
/**
 * 生成节点列表。
 * @param {object} opts
 * @param {object} opts.env - 环境对象(含 SHARED_KV)
 * @param {Request|{cf:object}|undefined} opts.request - 客户端请求(用于运营商识别)
 * @param {object} opts.user - 用户数据 { userID, trojanSecret }
 * @returns {Promise<string[]>} vless:// 节点 URI 数组
 */
export async function buildNodes({ env, request, user, operatorOverride = null }) {
  const config = await loadNodeConfig(env);
  const hosts = Array.isArray(config.HOSTS) && config.HOSTS.length ? config.HOSTS : ['edgetunnel'];
  const nodeParams = config.节点参数 || {};
  const protocols = Array.isArray(config.protocols) && config.protocols.length ? config.protocols : ['vless'];
  const transports = Array.isArray(config.transports) && config.transports.length ? config.transports : ['websocket'];
  const nodeCount = nodeParams.节点数量 || 16;
  const optIP = nodeParams.优选IP;
  // 固定运营商(节点设置配置;auto 时回退)
  const fixedOperator = optIP?.运营商 && optIP.运营商 !== 'auto' ? optIP.运营商 : null;
  // 用户实时运营商(订阅源机制透传 x-misub-cf)优先,其次固定配置,最后识别
  const effectiveOperator = operatorOverride || fixedOperator || identifyOperator(request?.cf);

  // 生成优选 IP 替换(如果配置了优选 IP)
  let replacements = null;
  if (optIP?.模式) {
    replacements = await resolveIPReplacements(optIP, request, nodeCount, effectiveOperator);
  }

  const nodes = [];
  const echEnabled = Boolean(config.ECH);
  const echConfig = config.ECHConfig || {};
  const echDns = String(echConfig.dns || '').trim();
  for (let i = 0; i < nodeCount; i++) {
    const host = hosts[Math.floor(Math.random() * hosts.length)];
    const transport = transports[Math.floor(Math.random() * transports.length)];
    const protocol = protocols[Math.floor(Math.random() * protocols.length)];
    const prefix = transport === 'websocket' || transport === 'ws' ? 'ws' : transport;
    const params = normalizeNodeParams({
      ...nodeParams,
      path: `/${prefix}/${user.userID}/${protocol}`,
    });

    let address = config.HOST || 'edgetunnel';
    let port = 443;
    let name = `${operatorLabel(effectiveOperator)}${i + 1}`;
    if (replacements && replacements.length) {
      const rep = replacements[i % replacements.length];
      address = rep.address;
      port = rep.port;
      name = rep.name || name;
    }

    // ECH:node URI 加 &ech=domain+dns(domain='0' 时用节点 host)
    const query = new URLSearchParams(params.query);
    if (echEnabled && echDns) {
      const configuredDomain = String(echConfig.domain || echConfig.sni || '').trim();
      const domain = configuredDomain === '0' ? host : (configuredDomain || host);
      query.set('ech', domain ? `${domain}+${echDns}` : echDns);
    }

    nodes.push({
      protocol,
      transport,
      host,
      sni: host,
      credential: protocol === 'vless' ? user.userID : (user.trojanSecret || user.userID),
      address,
      port,
      path: params.path,
      query,
      fingerprint: nodeParams.Fingerprint || nodeParams.fingerprint || 'chrome',
      name,
    });
  }
  return nodes.map((node) => buildNodeURI(node));
}
