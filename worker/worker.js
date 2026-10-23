/**
 * dm-sync — Cloudflare Worker
 * ------------------------------------------------------------
 * 用途：
 *   为静态站点（GitHub Pages）提供高亮笔记的跨设备同步。
 *   服务端只保存“密文”，不保存明文，也不接触同步密钥。
 *
 * 协议：
 *   GET  /v1/vault/:id
 *        -> 200 { rev, ciphertext, updatedAt }
 *        -> 200 { rev: 0, ciphertext: null, updatedAt: 0 }   // 尚未创建
 *
 *   PUT  /v1/vault/:id
 *        Header: If-Match: "<rev>"        // 新建时传 "0"
 *        Header: X-Vault-Token: <hash>    // 可选；首次 PUT 后锁定
 *        Body:   { "ciphertext": "..." }
 *        -> 200 { rev, updatedAt }
 *        -> 409 { error: "conflict", rev }   // 版本冲突，客户端拉取合并后重试
 *        -> 428 { error: "precondition_required" }
 *
 * 环境变量 / 绑定：
 *   VAULTS          KV Namespace Binding（必须）
 *   ALLOWED_ORIGIN  允许的站点来源，逗号分隔
 *                   例如：https://dengyifan.github.io,http://localhost:*
 *   MAX_BYTES       请求体上限，默认 5MB
 *   VAULT_PREFIX    KV key 前缀，默认 "vault:"
 *
 * 注意：
 *   Cloudflare KV 是最终一致的，极短时间内并发 PUT 仍可能互相覆盖。
 *   个人同步场景下概率很低；客户端通过 rev + 合并重试处理常规冲突。
 */

const DEFAULT_ALLOWED_ORIGIN = 'https://dengyifan.github.io';
const DEFAULT_PREFIX = 'vault:';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const VAULT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch (error) {
      // 不要把请求体或密钥写进日志
      console.error('dm-sync internal error:', error && error.stack ? error.stack : error);
      return json(
        { error: 'internal_error' },
        500,
        corsHeaders(request, env)
      );
    }
  }
};

async function handle(request, env) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  const origin = request.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);

  // 浏览器跨域来源必须白名单；curl 等无 Origin 的请求不受影响
  if (origin && !originAllowed(origin, allowed)) {
    return new Response('Forbidden origin', { status: 403 });
  }

  // CORS 预检
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, env, true)
    });
  }

  // 健康检查
  if (pathname === '/' || pathname === '/health') {
    return json(
      { ok: true, service: 'dm-sync' },
      200,
      corsHeaders(request, env)
    );
  }

  const match = pathname.match(/^\/v1\/vault\/([^/]+)$/);
  if (!match) {
    return json({ error: 'not_found' }, 404, corsHeaders(request, env));
  }

  const vaultId = match[1];
  if (!VAULT_ID_RE.test(vaultId)) {
    return json({ error: 'invalid_vault_id' }, 400, corsHeaders(request, env));
  }

  if (!env.VAULTS) {
    return json({ error: 'kv_binding_missing' }, 500, corsHeaders(request, env));
  }

  if (request.method === 'GET') {
    return getVault(request, env, vaultId);
  }

  if (request.method === 'PUT') {
    return putVault(request, env, vaultId);
  }

  const headers = corsHeaders(request, env);
  headers.set('Allow', 'GET, PUT, OPTIONS');
  return json({ error: 'method_not_allowed' }, 405, headers);
}

/* ============================================================
 * 读取
 * ============================================================ */
async function getVault(request, env, vaultId) {
  const key = vaultKey(env, vaultId);
  const headers = corsHeaders(request, env);
  const raw = await env.VAULTS.get(key);

  if (!raw) {
    headers.set('ETag', '"0"');
    return json(
      { rev: 0, ciphertext: null, updatedAt: 0 },
      200,
      headers
    );
  }

  let record;
  try {
    record = JSON.parse(raw);
  } catch (error) {
    return json({ error: 'corrupt_vault' }, 500, headers);
  }

  if (!record || !Number.isSafeInteger(record.rev)) {
    return json({ error: 'corrupt_vault' }, 500, headers);
  }

  const token = request.headers.get('X-Vault-Token') || '';
  if (record.tokenHash && token !== record.tokenHash) {
    return json({ error: 'unauthorized' }, 401, headers);
  }

  headers.set('ETag', '"' + record.rev + '"');
  return json(
    {
      rev: record.rev,
      ciphertext: record.ciphertext,
      updatedAt: record.updatedAt || 0
    },
    200,
    headers
  );
}

/* ============================================================
 * 写入
 * ============================================================ */
async function putVault(request, env, vaultId) {
  const headers = corsHeaders(request, env);

  // 先看 Content-Length（如果有），避免读取超大请求
  const declared = Number(request.headers.get('Content-Length') || 0);
  const limit = maxBytes(env);
  if (declared && declared > limit) {
    return json(
      { error: 'payload_too_large', maxBytes: limit },
      413,
      headers
    );
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > limit) {
    return json(
      { error: 'payload_too_large', maxBytes: limit },
      413,
      headers
    );
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    return json({ error: 'invalid_json' }, 400, headers);
  }

  if (!body || typeof body.ciphertext !== 'string' || body.ciphertext.length === 0) {
    return json({ error: 'invalid_payload' }, 400, headers);
  }

  const key = vaultKey(env, vaultId);
  const raw = await env.VAULTS.get(key);

  let current = null;
  if (raw) {
    try {
      current = JSON.parse(raw);
    } catch (error) {
      return json({ error: 'corrupt_vault' }, 500, headers);
    }
    if (!current || !Number.isSafeInteger(current.rev)) {
      return json({ error: 'corrupt_vault' }, 500, headers);
    }
  }

  const currentRev = current ? current.rev : 0;

  // 必须显式带上 If-Match（或 body.baseRev），避免无意覆盖
  const expected = expectedRev(request, body);
  if (expected === null) {
    return json(
      {
        error: 'precondition_required',
        message: 'Send If-Match: "<rev>"; use "0" when creating a new vault.'
      },
      428,
      headers
    );
  }

  // 版本冲突：客户端应重新 GET、合并、再 PUT
  if (expected !== currentRev) {
    headers.set('ETag', '"' + currentRev + '"');
    return json(
      { error: 'conflict', rev: currentRev },
      409,
      headers
    );
  }

  // 首次 PUT 时如果带了 X-Vault-Token，就锁定该 vault；
  // 之后所有 GET/PUT 都必须带相同的 token。
  const token = request.headers.get('X-Vault-Token') || '';
  if (current && current.tokenHash && token !== current.tokenHash) {
    return json({ error: 'unauthorized' }, 401, headers);
  }

  const nextRev = currentRev + 1;
  const next = {
    rev: nextRev,
    ciphertext: body.ciphertext,
    updatedAt: Date.now(),
    tokenHash: current ? (current.tokenHash || '') : (token || '')
  };

  await env.VAULTS.put(key, JSON.stringify(next));

  headers.set('ETag', '"' + nextRev + '"');
  return json(
    { rev: nextRev, updatedAt: next.updatedAt },
    200,
    headers
  );
}

/* ============================================================
 * 工具函数
 * ============================================================ */
function vaultKey(env, vaultId) {
  const prefix = env.VAULT_PREFIX || DEFAULT_PREFIX;
  return prefix + vaultId;
}

function maxBytes(env) {
  const value = Number(env.MAX_BYTES);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_BYTES;
}

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGIN || DEFAULT_ALLOWED_ORIGIN)
    .split(',')
    .map(function (item) { return item.trim().replace(/\/+$/, ''); })
    .filter(Boolean);
}

function originAllowed(origin, allowed) {
  return allowed.some(function (entry) {
    if (entry === '*') return true;
    if (entry === origin) return true;
    // 支持 http://localhost:* 这种端口通配
    if (entry.slice(-2) === ':*') {
      return origin.indexOf(entry.slice(0, -1)) === 0;
    }
    return false;
  });
}

function corsHeaders(request, env, preflight) {
  const headers = new Headers();
  const origin = request.headers.get('Origin');

  if (origin && originAllowed(origin, allowedOrigins(env))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
  }

  if (preflight) {
    headers.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    headers.set(
      'Access-Control-Allow-Headers',
      'Content-Type, If-Match, X-Vault-Token'
    );
    headers.set('Access-Control-Max-Age', '86400');
  }

  headers.set('Access-Control-Expose-Headers', 'ETag');
  return headers;
}

function expectedRev(request, body) {
  const ifMatch = request.headers.get('If-Match');

  if (ifMatch !== null) {
    const value = ifMatch
      .trim()
      .replace(/^W\//i, '')
      .replace(/^"+|"+$/g, '');

    if (!/^\d+$/.test(value)) return null;

    const rev = Number(value);
    return Number.isSafeInteger(rev) ? rev : null;
  }

  if (body && Number.isSafeInteger(body.baseRev) && body.baseRev >= 0) {
    return body.baseRev;
  }

  return null;
}

function json(data, status, headers) {
  const out = new Headers(headers || {});
  out.set('Content-Type', 'application/json; charset=utf-8');
  out.set('Cache-Control', 'no-store');
  out.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: out
  });
}
