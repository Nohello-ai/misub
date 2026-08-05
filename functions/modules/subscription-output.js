/**
 * MiSub 订阅输出端点
 *
 * 流程:客户端请求 /sub?uuid=X&token=Y
 *   1. 校验 token(sha256(uuid + MISUB_SECRET),MiSub 自己生成/校验)
 *   2. 调用户管理层拿用户数据(UUID/trojanSecret/配额/用量)
 *   3. node-builder 拼节点(共享 KV 节点参数 + 运营商识别)
 *   4. 返回订阅文本 + Subscription-Userinfo 流量头
 */

import { buildNodes } from './node-builder.js';

const USERINFO_EXPIRE = 4102329600; // 2099-12-31

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 生成订阅 token(MiSub 侧,与用户管理层无关) */
export async function subscriptionToken(uuid, secret) {
  return sha256Hex(`${uuid}:${secret}`);
}

/** 校验订阅 token */
async function verifyToken(uuid, token, secret) {
  if (!uuid || !token || !secret) return false;
  const expected = await subscriptionToken(uuid, secret);
  return expected === token;
}

/** 从用户管理层拉取用户数据(带管理 token) */
async function fetchUserFromAdmin(env, uuid) {
  const base = String(env?.ADMIN_API_BASE || '').replace(/\/+$/, '');
  const adminToken = env?.ADMIN_API_TOKEN || '';
  if (!base || !adminToken) return null;
  try {
    const res = await fetch(`${base}/api/admin/users/${uuid}`, {
      headers: { 'x-admin-token': adminToken },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.user || null;
  } catch {
    return null;
  }
}

/** 处理订阅请求 */
export async function handleSubscriptionRequest(request, env) {
  const url = new URL(request.url);
  const uuid = String(url.searchParams.get('uuid') || '').toLowerCase();
  const token = String(url.searchParams.get('token') || '');
  const secret = env?.MISUB_SECRET || '';

  if (!(await verifyToken(uuid, token, secret))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const user = await fetchUserFromAdmin(env, uuid);
  if (!user || user.disabled) {
    return new Response(JSON.stringify({ error: 'User unavailable' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const nodes = await buildNodes({ env, request, user });
    const subscription = nodes.join('\n');

    const usage = user.usage || {};
    const total = Number(usage.quota || 0);
    const userinfo = `upload=${Number(usage.upload || 0)}; download=${Number(usage.download || 0)}; total=${total}; expire=${USERINFO_EXPIRE}`;

    return new Response(subscription, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'subscription-userinfo': userinfo,
        'profile-update-interval': '24',
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Node build failed: ' + (e?.message || '') }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}
