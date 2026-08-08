/**
 * API路由处理模块
 * 处理所有API请求的路由分发
 */

import { StorageFactory, DataMigrator } from '../storage-adapter.js';
import { KV_KEY_SUBS, KV_KEY_SETTINGS } from './config.js';
import { loadNodeConfig, saveNodeConfig, buildNodes, identifyOperator } from './node-builder.js';
import { createJsonResponse, createErrorResponse, getAuthDebugInfo, JSON_BODY_LIMITS, readJsonWithLimit } from './utils.js';
import { authMiddleware, handleLogin, handleLogout, getAuthSessionDiagnostic } from './auth-middleware.js';
import { handleDataRequest, handleMisubsSave, handleSettingsGet, handleSettingsSave, handleSettingsReset, handlePublicProfilesRequest, handlePublicConfig, handleUpdatePassword } from './api-handler.js';
import { handleRuleTemplatesRequest } from './rule-template-handler.js';
import { handleCronTrigger } from './notifications.js';
import {
    handleSubscriptionNodesRequest,
    handlePublicPreviewRequest
} from './subscription-handler.js';
import {
    handleWebdavBackupStatus,
    handleWebdavBackupTest,
    handleManualWebdavBackup,
    handleWebdavBackupList,
    handleWebdavRestore,
    handleBackupExport,
    handleBackupRestore
} from './webdav-backup-handler.js';
import {
    handleDebugSubscriptionRequest,
    handleSystemInfoRequest,
    handleStorageTestRequest,
    handleExportDataRequest,
    handlePreviewContentRequest,
    handleTestNotificationRequest
} from './handlers/debug-handler.js';
import {
    handleNodeCountRequest as handleLegacyNodeCountRequest,
    handleBatchUpdateNodesRequest,
    handleCleanNodesRequest,
    handleHealthCheckRequest
} from './handlers/node-handler.js';
import { handleClientRequest } from './handlers/client-handler.js';
import { handleErrorReportRequest } from './handlers/error-report-handler.js';
import {
    handleGuestbookGet,
    handleGuestbookPost,
    handleGuestbookManageGet,
    handleGuestbookManageAction
} from './handlers/guestbook-handler.js';
import { handleGithubReleaseRequest } from './handlers/github-proxy-handler.js'; // [NEW] Import handler
import { handleParseSubscription } from './parse-subscription-handler.js';
import { safeFetchPublicUrl, validatePublicFetchUrl, redactUrl } from './security-utils.js';
import { normalizeSubconverterBackend } from './subscription/main-handler.js';
import { maybeRunScheduledTasks } from './scheduled-task-runner.js';
import { handleExternalNodesCallbackRequest } from '../services/external-nodes-callback-service.js';
import { handleExternalApiRequest } from './external-api-router.js';

// 常量定义
const OLD_KV_KEY = 'misub_data_v1';
const KV_KEY_PROFILES = 'misub_profiles_v1'; // Ensure this is defined if used

/** 确保内置订阅源 + 默认 Profile 存在(我的订阅页首次加载时创建,输入默认全部指向内部节点源) */
async function ensureInternalSubscription(env, origin) {
    try {
        const kv = StorageFactory.resolveKV(env);
        const subsRaw = await kv.get(KV_KEY_SUBS);
        let subs = [];
        try { subs = subsRaw ? JSON.parse(subsRaw) : []; } catch { subs = []; }
        if (!Array.isArray(subs)) subs = [];
        if (subs.some((s) => String(s?.url || '').includes('/internal/node-source'))) return;
        const secret = env?.NODE_SOURCE_SECRET || env?.MISUB_SECRET || '';
        const sub = {
            id: crypto.randomUUID(),
            name: '内置节点',
            url: `${origin}/api/internal/node-source?secret=${secret}`,
            enabled: true,
            createdAt: new Date().toISOString(),
        };
        subs.push(sub);
        await kv.put(KV_KEY_SUBS, JSON.stringify(subs));
        const profilesRaw = await kv.get(KV_KEY_PROFILES);
        let profiles = [];
        try { profiles = profilesRaw ? JSON.parse(profilesRaw) : []; } catch { profiles = []; }
        if (!Array.isArray(profiles)) profiles = [];
        if (!profiles.length) {
            profiles.push({
                id: crypto.randomUUID(),
                customId: 'default',
                name: '默认订阅',
                enabled: true,
                isPublic: false,
                subscriptions: [sub.id],
                manualNodes: [],
                includeSubscriptions: true,
                includeManualNodes: false,
                outputFormat: 'clash',
                createdAt: new Date().toISOString(),
            });
            await kv.put(KV_KEY_PROFILES, JSON.stringify(profiles));
        }
    } catch (e) {
        console.error('[init] ensureInternalSubscription failed:', e?.message);
    }
}

/**
 * 处理主要的API请求
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleApiRequest(request, env, context = null) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api/, '');

    if (path === '/external-nodes-callback') {
        return handleExternalNodesCallbackRequest(request, env);
    }

    if (path.startsWith('/ext/v1')) {
        return await handleExternalApiRequest(request, env);
    }

    // [新增] 数据存储迁移接口 (KV -> D1)
    if (path === '/migrate_to_d1') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        try {
            if (!env.MISUB_DB) {
                return createJsonResponse({
                    success: false,
                    message: 'D1 数据库未配置，请检查 wrangler.toml 配置'
                }, 400);
            }
            const migrationResult = await DataMigrator.migrateKVToD1(env);
            if (migrationResult.errors.length > 0) {
                return createJsonResponse({
                    success: false,
                    message: '迁移过程中出现错误',
                    details: migrationResult.errors,
                    partialSuccess: migrationResult
                }, 500);
            }
            return createJsonResponse({
                success: true,
                message: '数据已成功迁移到 D1 数据库',
                details: migrationResult
            });

        } catch (error) {
            console.error('[API Error /migrate_to_d1]', error);
            return createErrorResponse(error, 500);
        }
    }

    if (path === '/detect_legacy_d1') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        try {
            const result = await DataMigrator.detectLegacyD1MainRows(env);
            return createJsonResponse({ success: true, data: result });
        } catch (error) {
            console.error('[API Error /detect_legacy_d1]', error);
            return createErrorResponse(error, 500);
        }
    }

    if (path === '/migrate_legacy_d1') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        try {
            const migrationResult = await DataMigrator.migrateLegacyD1MainRows(env);
            if (migrationResult.errors.length > 0) {
                return createJsonResponse({
                    success: false,
                    message: '旧 D1 结构迁移过程中出现错误',
                    details: migrationResult.errors,
                    partialSuccess: migrationResult
                }, 500);
            }
            return createJsonResponse({
                success: true,
                message: '旧 D1 结构已成功迁移为行级存储',
                details: migrationResult
            });
        } catch (error) {
            console.error('[API Error /migrate_legacy_d1]', error);
            return createErrorResponse(error, 500);
        }
    }

    // [新增] 安全的、可重复执行的迁移接口
    if (path === '/migrate') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        try {
            const kv = StorageFactory.resolveKV(env);
            if (!kv) {
                return createJsonResponse({ success: false, message: 'KV 未绑定' }, 400);
            }
            const oldData = await kv.get(OLD_KV_KEY).then(r => r ? JSON.parse(r) : null);
            const newDataRaw = await kv.get(KV_KEY_SUBS);
            const newDataExists = newDataRaw !== null;

            if (newDataExists) {
                return createJsonResponse({ success: true, message: '无需迁移，数据已是最新结构。' }, 200);
            }
            if (!oldData) {
                return createJsonResponse({ success: false, message: '未找到需要迁移的旧数据。' }, 404);
            }

            await kv.put(KV_KEY_SUBS, JSON.stringify(oldData));
            await kv.put(KV_KEY_PROFILES, JSON.stringify([]));
            await kv.put(OLD_KV_KEY + '_migrated_on_' + new Date().toISOString(), JSON.stringify(oldData));
            await kv.delete(OLD_KV_KEY);

            return createJsonResponse({ success: true, message: '数据迁移成功！' }, 200);
        } catch (e) {
            console.error('[API Error /migrate]', e);
            return createErrorResponse(e, 500);
        }
    }

    if (path === '/login') {
        return await handleLogin(request, env);
    }


    // 内部节点源(订阅源机制拉取,secret 校验,不对外暴露;只返回节点文本,流量头由订阅出口处理)
    if (path === '/internal/node-source' && request.method === 'GET') {
        const secret = env?.NODE_SOURCE_SECRET || env?.MISUB_SECRET || '';
        if (!secret || url.searchParams.get('secret') !== secret) return createJsonResponse({ error: 'Unauthorized' }, 401);
        const userID = url.searchParams.get('uuid') || String(env?.ADMIN_UUID || '').trim() || 'a5aea414-bd01-48f1-9c82-1553c57b4033';
        try {
            // 用户实时运营商:MiSub 层识别后通过 ?operator= 传递(query 最可靠)
            let operatorOverride = null;
            const opParam = url.searchParams.get('operator');
            if (opParam && ['ct', 'cu', 'cmcc', 'cf'].includes(opParam)) {
                operatorOverride = opParam;
            } else {
                // 兜底:header 透传
                const cfHeader = request.headers.get('x-misub-cf');
                if (cfHeader) {
                    try { operatorOverride = identifyOperator(JSON.parse(cfHeader)); } catch { /* 解析失败回退 */ }
                }
            }
            // 客户端类型(target):优先 query,兜底 UA 判断
            let target = url.searchParams.get('target') || '';
            if (!target) {
                const ua = String(request.headers.get('user-agent') || '').toLowerCase();
                if (/clash|mihomo/.test(ua)) target = 'clash';
                else if (/sing[-_ ]?box/.test(ua)) target = 'singbox';
                else if (/surge/.test(ua)) target = 'surge';
                else if (/loon/.test(ua)) target = 'loon';
                else if (/quanx|quantumult/.test(ua)) target = 'quanx';
                else if (/shadowrocket/.test(ua)) target = 'shadowrocket';
                else if (/v2ray|xray/.test(ua)) target = 'v2ray';
            }
            const nodes = await buildNodes({ env, request, user: { userID }, operatorOverride, target });
            return new Response(nodes.join('\n'), {
                headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
            });
        } catch (e) {
            return createJsonResponse({ error: 'Node build failed: ' + (e?.message || '') }, 500);
        }
    }

    // 注册(转发到用户管理层 v2 /api/auth/register)
    if (path === '/register' && request.method === 'POST') {
        const base = String(env?.ADMIN_API_BASE || '').replace(/\/+$/, '');
        if (!base) return createJsonResponse({ error: '后端未配置' }, 503);
        const body = await request.text();
        const res = await fetch(`${base}/api/auth/register`, {
            method: 'POST',
            headers: { 'content-type': request.headers.get('content-type') || 'application/json' },
            body,
        });
        const text = await res.text();
        return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
    }

    if (path === '/public_config' || path === '/config') {
        return await handlePublicConfig(env);
    }

    if (path === '/public/profiles') {
        return await handlePublicProfilesRequest(env);
    }

    if (path === '/public/preview') {
        return await handlePublicPreviewRequest(request, env);
    }

    // 留言板公开接口
    if (path === '/public/guestbook') {
        if (request.method === 'GET') {
            return await handleGuestbookGet(env);
        }
        if (request.method === 'POST') {
            return await handleGuestbookPost(request, env);
        }
        return createErrorResponse('Method Not Allowed', 405);
    }


    // Error report endpoint (public)
    if (path === '/system/error_report') {
        return await handleErrorReportRequest(request, env);
    }

    // Public GET access for clients
    if (path.startsWith('/clients') && request.method === 'GET') {
        return await handleClientRequest(request, env);
    }

    // Special handling for /data to return 200 OK for unauthenticated requests
    if (path === '/data') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({
                authenticated: false,
                message: 'Not logged in'
            });
        }


        return await handleDataRequest(env, context || { env });
    }

    // [New] GitHub Proxy Route (Public)
    if (path === '/github/release') {
        return await handleGithubReleaseRequest(request, env);
    }

    // Logout 无需认证（cookie 过期时也需能正常登出）
    if (path === '/logout') {
        return await handleLogout(request);
    }



    if (!await authMiddleware(request, env)) {
        return createJsonResponse({ error: 'Unauthorized' }, 401);
    }

    // 用户管理代理:转发到 v2 计费后端 admin API(带管理 token)
    if (path.startsWith('/useradmin')) {
        const base = String(env?.ADMIN_API_BASE || '').replace(/\/+$/, '');
        const token = env?.ADMIN_API_TOKEN || '';
        if (!base || !token) return createJsonResponse({ error: '用户管理后端未配置(ADMIN_API_BASE/ADMIN_API_TOKEN)' }, 503);
        const targetPath = path.replace(/^\/useradmin/, '/api/admin');
        const targetUrl = `${base}${targetPath}${url.search}`;
        try {
            const headers = new Headers();
            headers.set('x-admin-token', token);
            headers.set('content-type', request.headers.get('content-type') || 'application/json');
            const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
            const res = await fetch(targetUrl, { method: request.method, headers, body });
            return new Response(res.body, {
                status: res.status,
                headers: { 'content-type': res.headers.get('content-type') || 'application/json' },
            });
        } catch (e) {
            return createJsonResponse({ error: '用户管理后端不可达: ' + (e?.message || '') }, 502);
        }
    }

    // 当前登录用户信息(从 session 解析 uuid,并拉取用量)
    if (path === '/me') {
        const diag = await getAuthSessionDiagnostic(request, env);
        if (!diag.isAuthenticated) return createJsonResponse({ error: 'Unauthorized' }, 401);
        let usage = null;
        let role = 'user';
        if (diag.userID) {
            const base = String(env?.ADMIN_API_BASE || '').replace(/\/+$/, '');
            const token = env?.ADMIN_API_TOKEN || '';
            if (base && token) {
                try {
                    const res = await fetch(`${base}/api/admin/users/${diag.userID}`, {
                        headers: { 'x-admin-token': token },
                    });
                    const data = await res.json().catch(() => ({}));
                    if (data?.ok && data?.user) {
                        usage = data.user.usage || null;
                        role = data.user.role || 'user';
                    }
                } catch (_) { /* usage 拉取失败不阻塞 */ }
            }
        }
        // 确保内置订阅源 + 默认 Profile 存在,并返回原版订阅链接参数
        let subscription = null;
        try {
            await ensureInternalSubscription(env, url.origin);
            const kv = StorageFactory.resolveKV(env);
            const profilesRaw = await kv.get(KV_KEY_PROFILES);
            let profiles = [];
            try { profiles = profilesRaw ? JSON.parse(profilesRaw) : []; } catch { profiles = []; }
            const profile = Array.isArray(profiles) && profiles.length ? profiles[0] : null;
            const settingsRaw = await kv.get(KV_KEY_SETTINGS);
            let settings = {};
            try { settings = settingsRaw ? JSON.parse(settingsRaw) : {}; } catch { settings = {}; }
            if (profile) {
                subscription = {
                    profileToken: settings.profileToken || 'profiles',
                    profileId: profile.customId || profile.id,
                };
            }
        } catch (_) { /* 订阅初始化失败不阻塞 */ }
        return createJsonResponse({ success: true, user: { userID: diag.userID, username: diag.username, role }, usage, subscription });
    }

    // 节点配置(共享 KV 读写,需 MiSub 登录)
    if (path === '/node-config' && request.method === 'GET') {
        const config = await loadNodeConfig(env);
        return createJsonResponse({
            success: true,
            data: {
                HOSTS: config.HOSTS || [],
                protocols: config.protocols || ['vless'],
                transports: config.transports || ['websocket'],
                nodeParams: config.节点参数 || {},
                反代: config.反代 || { 模式: '', PROXYIP: '', SOCKS5: {} },
                ECH: config.ECH || false,
                ECHConfig: config.ECHConfig || {},
            },
        });
    }
    if (path === '/node-config' && request.method === 'PUT') {
        const payload = await readJsonWithLimit(request, { max: 256 * 1024 });
        const config = await loadNodeConfig(env);
        if (Array.isArray(payload?.HOSTS)) config.HOSTS = payload.HOSTS;
        if (Array.isArray(payload?.protocols)) config.protocols = payload.protocols;
        if (Array.isArray(payload?.transports)) config.transports = payload.transports;
        if (payload?.nodeParams && typeof payload.nodeParams === 'object') {
            config.节点参数 = { ...(config.节点参数 || {}), ...payload.nodeParams };
        }
        if (payload?.反代 && typeof payload.反代 === 'object') {
            config.反代 = { ...(config.反代 || {}), ...payload.反代 };
        }
        if ('ECH' in payload) config.ECH = Boolean(payload.ECH);
        if (payload?.ECHConfig && typeof payload.ECHConfig === 'object') {
            config.ECHConfig = { ...(config.ECHConfig || {}), ...payload.ECHConfig };
        }
        await saveNodeConfig(env, config);
        return createJsonResponse({ success: true });
    }

    // Auth-only route for client management (POST, DELETE, etc.)
    if (path.startsWith('/clients')) {
        return await handleClientRequest(request, env);
    }

    if (path === '/test_notification') {
        if (!await authMiddleware(request, env)) {
            return createJsonResponse({ error: 'Unauthorized' }, 401);
        }
        return await handleTestNotificationRequest(request, env);
    }

    // KV 诊断端点：测试 KV 读写是否正常（需登录）
    if (path === '/kv_test') {
        try {
            const kv = StorageFactory.resolveKV(env);
            if (!kv) {
                // 列出 env 中所有 key 及其类型，帮助诊断绑定情况
                const envKeys = env ? Object.keys(env).map(k => {
                    const v = env[k];
                    const t = typeof v;
                    const isKVLike = v && t === 'object' && typeof v.get === 'function';
                    return `${k}(${t}${isKVLike ? ',KV-like' : ''})`;
                }) : [];
                return createJsonResponse({ success: false, error: 'KV 未绑定', envKeys });
            }
            const testKey = '__kv_test_' + Date.now();
            const testValue = 'test_' + Math.random().toString(36).slice(2);

            // 写入
            let putError = null;
            try {
                await kv.put(testKey, testValue);
            } catch (e) {
                putError = e.message;
            }

            // 读回
            let readBack = null;
            let getError = null;
            try {
                readBack = await kv.get(testKey);
            } catch (e) {
                getError = e.message;
            }

            // 清理
            try { await kv.delete(testKey); } catch (_) {}

            // 读取实际数据键
            let subsRaw = null;
            let subsError = null;
            try {
                subsRaw = await kv.get('misub_subscriptions_v1');
            } catch (e) {
                subsError = e.message;
            }

            let settingsRaw = null;
            try {
                settingsRaw = await kv.get('worker_settings_v1');
            } catch (_) {}

            return createJsonResponse({
                success: true,
                kvBound: true,
                writeTest: {
                    wrote: testValue,
                    readBack,
                    match: readBack === testValue,
                    putError,
                    getError
                },
                actualData: {
                    subscriptions: subsRaw ? `存在，长度=${subsRaw.length}` : 'null（空）',
                    settings: settingsRaw ? `存在，长度=${settingsRaw.length}` : 'null（空）',
                    subsError
                }
            });
        } catch (e) {
            return createJsonResponse({ success: false, error: e.message });
        }
    }

    switch (path) {
        case '/misubs':
            return await handleMisubsSave(request, env);

        case '/rule_templates':
            return await handleRuleTemplatesRequest(request, env);

        case '/backup/export':
            return await handleBackupExport(request, env);

        case '/backup/restore':
            return await handleBackupRestore(request, env);

        case '/backup/webdav/status':
            return await handleWebdavBackupStatus(env);

        case '/backup/webdav/test':
            return await handleWebdavBackupTest(request, env);

        case '/backup/webdav/run':
            return await handleManualWebdavBackup(request, env);

        case '/backup/webdav/list':
            return await handleWebdavBackupList(request, env);

        case '/backup/webdav/restore':
            return await handleWebdavRestore(request, env);

        case '/node_count':
            return await handleLegacyNodeCountRequest(request, env);

        case '/nodes/health':
            return await handleHealthCheckRequest(request, env);

        case '/nodes/clean':
            return await handleCleanNodesRequest(request, env);

        case '/fetch_external_url':
            return await handleExternalFetchRequest(request, env);

        case '/batch_update_nodes':
            return await handleBatchUpdateNodesRequest(request, env);

        case '/subscription_nodes':
            return await handleSubscriptionNodesRequest(request, env);

        case '/debug_subscription':
            return await handleDebugSubscriptionRequest(request, env);

        case '/system/info':
            return await handleSystemInfoRequest(request, env);

        case '/system/storage_test':
            return await handleStorageTestRequest(request, env);

        case '/system/export':
            return await handleExportDataRequest(request, env);

        case '/preview/content':
            return await handlePreviewContentRequest(request, env);

        case '/parse_subscription':
            return await handleParseSubscription(request, env);

        case '/subconverter/test':
            return await handleSubconverterTestRequest(request, env);

        case '/logs':
            if (request.method === 'GET') {
                const { LogService } = await import('../services/log-service.js');
                const logs = await LogService.getLogs(env);
                return createJsonResponse({ success: true, data: logs }, 200, {
                    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
                });
            }
            if (request.method === 'DELETE') {
                const { LogService } = await import('../services/log-service.js');
                await LogService.clearLogs(env);
                return createJsonResponse({ success: true });
            }
            return createErrorResponse('Method Not Allowed', 405);

        case '/settings':
            if (request.method === 'GET') {
                return await handleSettingsGet(env);
            }
            if (request.method === 'POST') {
                return await handleSettingsSave(request, env);
            }
            return createJsonResponse('Method Not Allowed', 405);

        case '/settings/password':
            return await handleUpdatePassword(request, env);

        case '/settings/reset':
            if (request.method === 'POST') {
                return await handleSettingsReset(env);
            }
            return createErrorResponse('Method Not Allowed', 405);

        case '/guestbook/manage':
            if (request.method === 'GET') {
                return await handleGuestbookManageGet(env);
            }
            if (request.method === 'POST') {
                return await handleGuestbookManageAction(request, env);
            }
            return createErrorResponse('Method Not Allowed', 405);

        case '/cron/status':
            if (!await authMiddleware(request, env)) {
                return createJsonResponse({ error: 'Unauthorized' }, 401);
            }
            return await handleCronStatusRequest(env);

        case '/cron/trigger':
            if (!await authMiddleware(request, env)) {
                return createJsonResponse({ error: 'Unauthorized' }, 401);
            }
            return await handleCronTriggerRequest(env);

        default:
            return createErrorResponse('API route not found', 404);
    }
}

export async function handleSubconverterTestRequest(request, env) {
    if (request.method !== 'POST') {
        return createErrorResponse('Method Not Allowed', 405);
    }

    let requestData;
    try {
        requestData = await readJsonWithLimit(request, JSON_BODY_LIMITS.normal);
    } catch (e) {
        return createErrorResponse(e.status === 413 ? e.message : 'Invalid JSON format', e.status || 400);
    }

    const { backend, target = 'clash', timeout = 15000 } = requestData || {};
    let endpoint;
    try {
        endpoint = normalizeSubconverterBackend(backend);
    } catch (error) {
        return createJsonResponse({
            success: false,
            error: '转换后端地址无效，请填写域名或 http(s) URL。',
            details: error.message
        }, 400);
    }

    const safeTarget = /^[a-z0-9_-]{2,32}$/i.test(String(target || '')) ? String(target).toLowerCase() : 'clash';
    const controller = new AbortController();
    const normalizedTimeout = Math.min(Math.max(Number(timeout) || 15000, 3000), 30000);
    const timeoutId = setTimeout(() => controller.abort(), normalizedTimeout);

    try {
        // 使用公开测试节点内容直接传给后端，避免探测时依赖用户订阅链接或 MiSub 回调 URL。
        endpoint.searchParams.set('target', safeTarget);
        endpoint.searchParams.set('url', 'trojan://password@example.com:443?allowInsecure=1&sni=example.com#MiSub-Test-Node');
        endpoint.searchParams.set('insert', 'false');
        endpoint.searchParams.set('emoji', 'false');
        endpoint.searchParams.set('list', 'false');
        endpoint.searchParams.set('udp', 'true');
        endpoint.searchParams.set('tfo', 'false');
        endpoint.searchParams.set('scv', 'true');
        endpoint.searchParams.set('sort', 'false');

        const startedAt = Date.now();
        const response = await fetch(new Request(endpoint.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'MiSub/Backend-Test',
                'Accept': '*/*',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        }));
        const elapsedMs = Date.now() - startedAt;
        clearTimeout(timeoutId);

        const text = await response.text();
        const sample = text.slice(0, 200);
        const hasUsableOutput = response.ok && /MiSub-Test-Node|proxies:|proxy-groups:|trojan/i.test(text);

        return createJsonResponse({
            success: hasUsableOutput,
            available: hasUsableOutput,
            status: response.status,
            statusText: response.statusText,
            endpoint: `${endpoint.origin}${endpoint.pathname}`,
            elapsedMs,
            sample,
            message: hasUsableOutput
                ? `第三方转换后端可用，响应 ${response.status}，耗时 ${elapsedMs}ms。`
                : `后端已响应但未返回有效转换结果（HTTP ${response.status}）。`
        }, response.ok ? 200 : 502);
    } catch (error) {
        clearTimeout(timeoutId);
        const isTimeout = error.name === 'AbortError';
        console.error('[Subconverter Test] Error:', {
            backend: endpoint ? `${endpoint.origin}${endpoint.pathname}` : '[invalid]',
            error: error.message,
            type: isTimeout ? 'timeout' : 'network'
        });
        return createJsonResponse({
            success: false,
            available: false,
            endpoint: endpoint ? `${endpoint.origin}${endpoint.pathname}` : null,
            error: isTimeout ? `测试超时（${normalizedTimeout}ms）` : `无法连接转换后端：${error.message}`,
            errorType: isTimeout ? 'timeout' : 'network'
        }, 502);
    }
}

/**
 * 处理外部URL获取请求
 * @param {Object} request - HTTP请求对象
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
export async function handleExternalFetchRequest(request, env) {
    if (request.method !== 'POST') {
        return createErrorResponse('Method Not Allowed', 405);
    }

    let requestData;
    try {
        requestData = await readJsonWithLimit(request, JSON_BODY_LIMITS.normal);
    } catch (e) {
        return createErrorResponse(e.status === 413 ? e.message : 'Invalid JSON format', e.status || 400);
    }

    const { url: externalUrl, timeout = 15000 } = requestData;

    if (!externalUrl || typeof externalUrl !== 'string') {
        return createErrorResponse('Invalid or missing URL parameter. Must be a valid HTTP/HTTPS URL.', 400);
    }

    // 检查URL长度限制
    if (externalUrl.length > 2048) {
        return createErrorResponse('URL too long (max 2048 characters)', 400);
    }

    const urlValidation = validatePublicFetchUrl(externalUrl);
    if (!urlValidation.ok) {
        return createErrorResponse(urlValidation.error, 400);
    }

    try {
        // 创建带超时的请求
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await safeFetchPublicUrl(urlValidation.url.toString(), {
            method: 'GET',
            headers: {
                'User-Agent': 'v2rayN/7.23',
                'Accept': '*/*',
                'Cache-Control': 'no-cache'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[External Fetch] HTTP ${response.status}: ${errorText.substring(0, 200)}`);

            return createJsonResponse({
                error: `Failed to fetch external URL: HTTP ${response.status} ${response.statusText}`,
                status: response.status,
                statusText: response.statusText
            }, response.status);
        }

        // 检查内容类型和大小
        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) { // 10MB limit
            return createErrorResponse('Content too large (max 10MB limit)', 413);
        }

        const contentType = response.headers.get('content-type') || '';

        // 读取响应体并生成 Base64 兜底内容
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > 10 * 1024 * 1024) { // 10MB limit
            return createErrorResponse('Response content too large (max 10MB limit)', 413);
        }

        const content = new TextDecoder('utf-8').decode(buffer);
        const contentBase64 = encodeArrayBufferToBase64(buffer);


        // 返回包含原文与 Base64 的结果
        return new Response(JSON.stringify({
            content,
            contentBase64,
            contentType,
            size: buffer.byteLength,
            url: externalUrl,
            success: true
        }), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-cache, no-store, must-revalidate'
            }
        });

    } catch (error) {
        let errorMessage = 'Unknown error occurred';
        let errorDetails = {};

        if (error.name === 'AbortError') {
            errorMessage = `Request timeout after ${timeout}ms`;
            errorDetails = { type: 'timeout', timeout };
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            errorMessage = 'Network error - unable to reach the server';
            errorDetails = { type: 'network', originalError: error.message };
        } else if (error.message.includes('DNS')) {
            errorMessage = 'DNS resolution failed';
            errorDetails = { type: 'dns', originalError: error.message };
        } else {
            errorMessage = `Request failed: ${error.message}`;
            errorDetails = { type: 'unknown', originalError: error.message };
        }

        console.error(`[External Fetch] Error:`, {
            url: redactUrl(externalUrl),
            error: error.message,
            errorType: errorDetails.type
        });

        return createErrorResponse(errorMessage, 500);
    }
}

/**
 * ArrayBuffer -> Base64 ??
 */
function encodeArrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
}

/**
 * 处理 Cron 状态查询请求
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
async function handleCronStatusRequest(env) {
    try {
        // 检查是否启用Cron功能
        const enableCron = env.ENABLE_CRON !== 'false';

        // 获取Cron配置
        const cronType = env.CRON_TYPE || 'hourly-subscription-sync';
        const maxSyncCount = parseInt(env.CRON_MAX_SYNC_COUNT) || 50;
        const syncTimeout = parseInt(env.CRON_SYNC_TIMEOUT) || 30000;
        const enableParallel = env.CRON_ENABLE_PARALLEL !== 'false';

        // 获取最近的Cron执行状态（如果有的话）
        let lastExecution = null;
        try {
            const kv = StorageFactory.resolveKV(env);
            if (kv) {
                const statusData = await kv.get('cron_last_execution');
                if (statusData) {
                    lastExecution = JSON.parse(statusData);
                }
            }
        } catch (error) {
            console.warn('[Cron Status] Failed to fetch last execution:', error);
        }

        const statusData = {
            enabled: enableCron,
            config: {
                type: cronType,
                maxSyncCount,
                syncTimeout,
                enableParallel
            },
            totalSubscriptions: lastExecution?.result?.totalSubscriptions || 0,
            successfulSyncs: lastExecution?.result?.successfulSyncs || 0,
            failedSyncs: lastExecution?.result?.failedSyncs || 0,
            lastSync: lastExecution?.timestamp || null,
            details: lastExecution?.result?.details || [],
            lastExecution,
            timestamp: new Date().toISOString()
        };

        return createJsonResponse(statusData);

    } catch (error) {
        console.error('[Cron Status Error]', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * 处理 Cron 手动触发请求
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Response>} HTTP响应
 */
async function handleCronTriggerRequest(env) {
    try {
        // 检查是否启用Cron功能
        const enableCron = env.ENABLE_CRON !== 'false';
        if (!enableCron) {
            return createJsonResponse({
                success: false,
                error: 'Cron functionality is disabled'
            }, 400);
        }

        // 获取Cron配置
        const cronType = env.CRON_TYPE || 'hourly-subscription-sync';
        const maxSyncCount = parseInt(env.CRON_MAX_SYNC_COUNT) || 50;
        const syncTimeout = parseInt(env.CRON_SYNC_TIMEOUT) || 30000;
        const enableParallel = env.CRON_ENABLE_PARALLEL !== 'false';

        // 调用 _schedule.js 中的同步逻辑
        const scheduleModule = await import('../_schedule.js');
        const result = await scheduleModule.performSubscriptionSync(env, {
            maxSyncCount,
            syncTimeout,
            enableParallel
        });

        // 保存执行状态
        try {
            const kv = StorageFactory.resolveKV(env);
            if (kv) {
                const executionStatus = {
                    type: 'manual_trigger',
                    cronType,
                    timestamp: new Date().toISOString(),
                    result: {
                        totalSubscriptions: result.totalSubscriptions,
                        successfulSyncs: result.successfulSyncs,
                        failedSyncs: result.failedSyncs
                    }
                };
                await kv.put('cron_last_execution', JSON.stringify(executionStatus), {
                    expirationTtl: 86400 // 24小时后过期
                });
            }
        } catch (error) {
            console.warn('[Cron Trigger] Failed to save execution status:', error);
        }

        const scheduledTasks = await maybeRunScheduledTasks({ env }, {
            source: 'external-cron',
            forceCheck: true,
            awaitRun: true
        }).catch(error => ({ success: false, error: error?.message || String(error) }));

        return createJsonResponse({
            success: true,
            message: 'Cron triggered successfully',
            result,
            scheduledTasks,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[Cron Trigger Error]', error);
        return createErrorResponse(error, 500);
    }
}

/**
 * 执行订阅同步（复用_cron.js的逻辑）
 * @param {Object} env - Cloudflare环境对象
 * @param {Object} config - 同步配置
 * @returns {Promise<Object>} 同步结果
 */
async function performSubscriptionSync(env, config) {
    const { maxSyncCount = 50, syncTimeout = 30000, enableParallel = true } = config;

    const results = {
        timestamp: new Date().toISOString(),
        totalSubscriptions: 0,
        successfulSyncs: 0,
        failedSyncs: 0,
        config: { maxSyncCount, syncTimeout, enableParallel }
    };

    try {
        // 获取订阅列表
        const subscriptions = await getAllSubscriptions(env);
        results.totalSubscriptions = subscriptions.length;

        // 限制同步数量
        const subscriptionsToSync = subscriptions.slice(0, maxSyncCount);

        if (enableParallel) {
            // 并行同步
            const syncPromises = subscriptionsToSync.map(async (sub) => {
                try {
                    await performSingleSubscriptionSync(sub, env, syncTimeout);
                    return { success: true };
                } catch (error) {
                    console.error(`[Cron] Failed to sync ${sub.name}:`, error);
                    return { success: false, error: error.message };
                }
            });

            const syncResults = await Promise.allSettled(syncPromises);
            syncResults.forEach(result => {
                if (result.status === 'fulfilled' && result.value.success) {
                    results.successfulSyncs++;
                } else {
                    results.failedSyncs++;
                }
            });
        } else {
            // 串行同步
            for (const sub of subscriptionsToSync) {
                try {
                    await performSingleSubscriptionSync(sub, env, syncTimeout);
                    results.successfulSyncs++;
                } catch (error) {
                    console.error(`[Cron] Failed to sync ${sub.name}:`, error);
                    results.failedSyncs++;
                }
            }
        }

    } catch (error) {
        console.error('[Cron] Subscription sync error:', error);
        results.error = error.message;
    }

    return results;
}

/**
 * 获取所有订阅
 * @param {Object} env - Cloudflare环境对象
 * @returns {Promise<Array>} 订阅列表
 */
async function getAllSubscriptions(env) {
    try {
        const storageAdapter = StorageFactory.createAdapter(env, await StorageFactory.getStorageType(env));
        const subscriptions = await storageAdapter.get(KV_KEY_SUBS) || [];
        return Array.isArray(subscriptions) ? subscriptions : [];
    } catch (error) {
        console.error('[Cron] Failed to fetch subscriptions:', error);
        return [];
    }
}

/**
 * 执行单个订阅同步
 * @param {Object} subscription - 订阅对象
 * @param {Object} env - 环境变量
 * @param {number} timeout - 超时时间（毫秒）
 */
async function performSingleSubscriptionSync(subscription, env, timeout) {
    // 创建带超时的 AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        // 这里应该调用实际的订阅同步逻辑
        // 暂时使用模拟逻辑
        console.log(`[Single Sync] Processing ${subscription.name || subscription.url} with ${timeout}ms timeout`);

        // 模拟网络请求
        await new Promise((resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(new Error('Timeout')));
            setTimeout(resolve, Math.random() * 2000); // 模拟1-2秒的处理时间
        });

        clearTimeout(timeoutId);
        return { success: true };

    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}
