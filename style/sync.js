/* ============================================================
 * dm-sync 客户端
 * ------------------------------------------------------------
 * - 复用 style/highlight.js 的数据（localStorage 按页面存储）
 * - 把所有页面聚合成一个 vault，加密后同步到 Cloudflare Worker
 * - AES-GCM 端到端加密；Worker 只保存密文
 * - 同步码格式：<vaultId>.<secret>
 * - 配对链接：https://.../#dm-sync=<vaultId>.<secret>
 * ============================================================ */
(function () {
  'use strict';

  if (window.__dmSyncLoaded) return;
  window.__dmSyncLoaded = true;
  if (window.top !== window.self) return;

  // 允许页面在加载本脚本前通过 window.DM_SYNC_ENDPOINT 覆盖（本地测试/换域名用）
  var ENDPOINT = String(window.DM_SYNC_ENDPOINT ||
    'https://dm-sync.waynesilver.workers.dev').replace(/\/+$/, '');
  var CONFIG_KEY = 'dm-hl-sync:v1';
  var PUSH_DELAY = 1200;
  var PULL_THROTTLE = 25000;

  var config = null;
  var keyCache = null;
  var storePrefix = 'dm-hl:v1:';
  var syncBox = null;
  var busy = false;
  var queued = false;
  var dirty = false;
  var pushTimer = null;
  var lastPullAt = 0;
  var lastError = '';
  var statusKind = 'idle';
  var setupLink = '';
  var inputOpen = false;

  function SyncError(message) {
    this.name = 'SyncError';
    this.message = message;
  }
  SyncError.prototype = Object.create(Error.prototype);
  SyncError.prototype.constructor = SyncError;

  /* ============================================================
   * 编码 / 加密
   * ============================================================ */
  function bytesToBase64(bytes) {
    var binary = '';
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(text) {
    var binary = atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function b64urlEncode(bytes) {
    return bytesToBase64(bytes)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function b64urlDecode(text) {
    var value = String(text).replace(/-/g, '+').replace(/_/g, '/');
    while (value.length % 4) value += '=';
    return base64ToBytes(value);
  }

  function randomBytes(size) {
    var bytes = new Uint8Array(size);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  function toHex(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      out += ('0' + bytes[i].toString(16)).slice(-2);
    }
    return out;
  }

  function cryptoAvailable() {
    return !!(window.crypto && window.crypto.subtle &&
      window.TextEncoder && window.TextDecoder);
  }

  async function getKey() {
    if (keyCache) return keyCache;
    if (!config) throw new SyncError('尚未开启同步');
    if (!cryptoAvailable()) throw new SyncError('当前环境不支持加密，请使用 HTTPS 打开页面');
    var raw = b64urlDecode(config.secret);
    keyCache = await window.crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return keyCache;
  }

  async function getToken() {
    if (!config) throw new SyncError('尚未开启同步');
    if (config.token) return config.token;
    if (!cryptoAvailable()) throw new SyncError('当前环境不支持加密，请使用 HTTPS 打开页面');
    var digest = await window.crypto.subtle.digest(
      'SHA-256',
      b64urlDecode(config.secret)
    );
    config.token = toHex(new Uint8Array(digest));
    saveConfig();
    return config.token;
  }

  async function encryptDoc(doc) {
    var key = await getKey();
    var iv = randomBytes(12);
    var plain = new TextEncoder().encode(JSON.stringify(doc));
    var encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      plain
    );
    var packed = new Uint8Array(iv.length + encrypted.byteLength);
    packed.set(iv, 0);
    packed.set(new Uint8Array(encrypted), iv.length);
    return bytesToBase64(packed);
  }

  async function decryptDoc(ciphertext) {
    var key = await getKey();
    var packed = base64ToBytes(ciphertext);
    if (packed.length < 13) throw new SyncError('云端数据格式不正确');
    var iv = packed.slice(0, 12);
    var data = packed.slice(12);
    var plain = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  /* ============================================================
   * 同步文档
   * ============================================================ */
  function cleanReplacer(key, value) {
    return key && key.charAt(0) === '_' ? undefined : value;
  }

  function pathForKey(key) {
    var raw = key.slice(storePrefix.length);
    try {
      return new URL(raw).pathname || '/';
    } catch (e) {
      return raw;
    }
  }

  function keyForPath(path) {
    return storePrefix + location.origin + path;
  }

  function buildLocalDoc() {
    var pages = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(storePrefix) !== 0) continue;
        var raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          var data = JSON.parse(raw);
          if (data && Array.isArray(data.highlights) && data.highlights.length) {
            pages[pathForKey(key)] = data.highlights;
          }
        } catch (e) { /* 跳过损坏页面 */ }
      }
    } catch (e) { /* 忽略存储异常 */ }
    return { v: 1, pages: pages };
  }

  function hasLocalData(doc) {
    return Object.keys(doc.pages || {}).some(function (path) {
      return (doc.pages[path] || []).length > 0;
    });
  }

  function mergeLists(a, b) {
    var map = Object.create(null);

    function add(highlight) {
      if (!highlight || !highlight.id) return;
      var old = map[highlight.id];
      if (!old) {
        map[highlight.id] = highlight;
        return;
      }
      var incomingAt = highlight.updatedAt || 0;
      var currentAt = old.updatedAt || 0;
      if (incomingAt > currentAt ||
          (incomingAt === currentAt && highlight.deleted && !old.deleted)) {
        map[highlight.id] = highlight;
      }
    }

    (a || []).forEach(add);
    (b || []).forEach(add);
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function mergeDocs(local, remote) {
    var pages = {};
    var seen = Object.create(null);
    Object.keys((local && local.pages) || {}).forEach(function (p) { seen[p] = true; });
    Object.keys((remote && remote.pages) || {}).forEach(function (p) { seen[p] = true; });

    Object.keys(seen).forEach(function (path) {
      var a = (local.pages && local.pages[path]) || [];
      var b = (remote.pages && remote.pages[path]) || [];
      if (!a.length && !b.length) return;
      pages[path] = mergeLists(a, b);
    });

    return { v: 1, pages: pages };
  }

  function canonicalList(list) {
    var sorted = (list || [])
      .filter(function (h) { return h && h.id; })
      .slice()
      .sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return JSON.stringify(sorted, cleanReplacer);
  }

  function canonicalDoc(doc) {
    var pages = {};
    Object.keys((doc && doc.pages) || {}).sort().forEach(function (path) {
      var list = doc.pages[path];
      if (!Array.isArray(list) || !list.length) return;
      pages[path] = JSON.parse(canonicalList(list));
    });
    return JSON.stringify({ v: 1, pages: pages });
  }

  function applyDoc(doc) {
    var changed = false;
    Object.keys((doc && doc.pages) || {}).forEach(function (path) {
      var incoming = doc.pages[path];
      if (!Array.isArray(incoming) || !incoming.length) return;

      var key = keyForPath(path);
      var existing = null;
      try {
        existing = JSON.parse(localStorage.getItem(key) || 'null');
      } catch (e) { /* 忽略损坏数据 */ }

      var existingList = existing && Array.isArray(existing.highlights)
        ? existing.highlights
        : [];
      var merged = mergeLists(existingList, incoming);

      if (canonicalList(merged) === canonicalList(existingList)) return;

      try {
        localStorage.setItem(key, JSON.stringify({
          v: 1,
          url: location.origin + path,
          highlights: merged
        }, cleanReplacer));
        changed = true;
      } catch (e) {
        throw new SyncError('本地存储空间不足，无法应用云端数据');
      }
    });
    return changed;
  }

  /* ============================================================
   * 配置
   * ============================================================ */
  function isVaultId(value) {
    return /^[A-Za-z0-9_-]{16,64}$/.test(String(value || ''));
  }

  function isSecret(value) {
    return /^[A-Za-z0-9_-]{32,64}$/.test(String(value || ''));
  }

  function loadConfig() {
    try {
      var raw = localStorage.getItem(CONFIG_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !isVaultId(data.vaultId) || !isSecret(data.secret)) {
        localStorage.removeItem(CONFIG_KEY);
        return null;
      }
      return {
        v: 1,
        vaultId: data.vaultId,
        secret: data.secret,
        token: data.token || '',
        rev: Number(data.rev) || 0,
        lastSync: Number(data.lastSync) || 0,
        endpoint: ENDPOINT
      };
    } catch (e) {
      return null;
    }
  }

  function saveConfig() {
    try {
      if (config) {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      } else {
        localStorage.removeItem(CONFIG_KEY);
      }
    } catch (e) { /* 配额不足时静默 */ }
  }

  function parseCode(value) {
    var text = String(value || '').trim();
    var match = text.match(/(?:#?)dm-sync=([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,64})/);
    if (!match) {
      match = text.match(/^([A-Za-z0-9_-]{16,64})\.([A-Za-z0-9_-]{32,64})$/);
    }
    if (!match) return null;
    return { vaultId: match[1], secret: match[2] };
  }

  function setConfig(vaultId, secret) {
    if (config && config.vaultId === vaultId && config.secret === secret) return;
    config = {
      v: 1,
      vaultId: vaultId,
      secret: secret,
      token: '',
      rev: 0,
      lastSync: 0,
      endpoint: ENDPOINT
    };
    keyCache = null;
    lastError = '';
    saveConfig();
  }

  function clearHash() {
    try {
      history.replaceState(null, '', location.pathname + location.search);
    } catch (e) { /* 忽略 */ }
  }

  function consumeHash() {
    var hash = location.hash || '';
    if (hash.indexOf('dm-sync=') === -1) return false;
    var parsed = parseCode(hash);
    if (!parsed) {
      if (window.DMHighlights) window.DMHighlights.toast('同步链接格式不正确');
      clearHash();
      return false;
    }
    if (config &&
        (config.vaultId !== parsed.vaultId || config.secret !== parsed.secret)) {
      if (!window.confirm('当前已开启同步，是否用链接中的同步码替换？')) {
        clearHash();
        return false;
      }
    }
    setConfig(parsed.vaultId, parsed.secret);
    clearHash();
    return true;
  }

  function pairLink() {
    if (!config) return '';
    var base = location.origin + location.pathname + location.search;
    return base + '#dm-sync=' + config.vaultId + '.' + config.secret;
  }

  /* ============================================================
   * API
   * ============================================================ */
  function apiUrl() {
    return ENDPOINT.replace(/\/+$/, '') + '/v1/vault/' +
      encodeURIComponent(config.vaultId);
  }

  async function api(method, body, rev) {
    if (!config) throw new SyncError('同步已关闭');
    var headers = { 'X-Vault-Token': await getToken() };
    if (body != null) headers['Content-Type'] = 'application/json';
    if (typeof rev === 'number') headers['If-Match'] = '"' + rev + '"';

    var controller = typeof AbortController !== 'undefined'
      ? new AbortController()
      : null;
    var timer = controller
      ? setTimeout(function () { controller.abort(); }, 20000)
      : null;

    var options = {
      method: method,
      headers: headers,
      cache: 'no-store'
    };
    if (body != null) options.body = body;
    if (controller) options.signal = controller.signal;

    try {
      return await fetch(apiUrl(), options);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function friendlyNetworkError(error) {
    if (error && error.name === 'AbortError') {
      return '请求超时，请检查网络';
    }
    if (error && error.name === 'TypeError') {
      return '无法连接同步服务（网络或 CORS 限制）';
    }
    return error && error.message ? error.message : '网络请求失败';
  }

  async function pull() {
    if (!config) return { needPush: false, changed: false };

    var response;
    try {
      response = await api('GET');
    } catch (error) {
      throw new SyncError(friendlyNetworkError(error));
    }

    if (response.status === 401) {
      throw new SyncError('同步码无效，或云端 vault 已被其他密钥占用');
    }
    if (response.status === 403) {
      throw new SyncError('Worker 未允许当前站点来源，请检查 ALLOWED_ORIGIN');
    }
    if (!response.ok) {
      throw new SyncError('拉取失败：HTTP ' + response.status);
    }

    var data;
    try {
      data = await response.json();
    } catch (error) {
      throw new SyncError('云端返回格式不正确');
    }

    if (!config) return { needPush: false, changed: false };
    config.rev = Number(data.rev) || 0;
    config.lastSync = Date.now();
    saveConfig();

    if (!data.ciphertext) {
      return {
        needPush: hasLocalData(buildLocalDoc()),
        changed: false
      };
    }

    var remote;
    try {
      remote = await decryptDoc(data.ciphertext);
    } catch (error) {
      throw new SyncError('无法解密云端数据：同步码不正确或数据已损坏');
    }

    var local = buildLocalDoc();
    var merged = mergeDocs(local, remote);
    var changed = applyDoc(merged);

    if (changed && window.DMHighlights) {
      window.DMHighlights.reload();
    }

    return {
      needPush: canonicalDoc(merged) !== canonicalDoc(remote),
      changed: changed
    };
  }

  async function push(attempt) {
    attempt = attempt || 0;
    if (!config) return;
    clearTimeout(pushTimer);
    if (!cryptoAvailable()) {
      throw new SyncError('当前环境不支持加密，请使用 HTTPS 打开页面');
    }

    dirty = false;

    var ciphertext = await encryptDoc(buildLocalDoc());
    if (!config) return;

    var response;
    try {
      response = await api(
        'PUT',
        JSON.stringify({ ciphertext: ciphertext }),
        config.rev || 0
      );
    } catch (error) {
      throw new SyncError(friendlyNetworkError(error));
    }

    if (response.status === 409) {
      if (attempt >= 3) {
        throw new SyncError('同步冲突次数过多，请稍后重试');
      }
      var conflict = await response.json().catch(function () { return {}; });
      if (!config) return;
      if (typeof conflict.rev === 'number') {
        config.rev = conflict.rev;
        saveConfig();
      }
      await pull();
      return push(attempt + 1);
    }

    if (response.status === 401) {
      throw new SyncError('同步码无效，无法写入云端');
    }
    if (response.status === 403) {
      throw new SyncError('Worker 未允许当前站点来源');
    }
    if (response.status === 413) {
      throw new SyncError('高亮数据过大，云端拒绝写入');
    }
    if (!response.ok) {
      throw new SyncError('推送失败：HTTP ' + response.status);
    }

    var result = await response.json().catch(function () { return {}; });
    if (!config) return;
    if (typeof result.rev === 'number') config.rev = result.rev;
    config.lastSync = Date.now();
    saveConfig();

    if (dirty) schedulePush(800);
  }

  async function pushNow(options) {
    if (!config) return;
    if (busy) { queued = true; return; }

    clearTimeout(pushTimer);
    busy = true;
    if (!options || !options.silent) setStatus('syncing');

    try {
      await push(0);
      setStatus('idle');
    } catch (error) {
      dirty = true;
      handleError(error, options);
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        // 期间可能有别的标签页/设备写入，重新走一次 pull + push
        syncNow({ silent: true });
      }
    }
  }

  async function syncNow(options) {
    if (!config) return;
    if (busy) { queued = true; return; }

    clearTimeout(pushTimer);
    busy = true;
    if (!options || !options.silent) setStatus('syncing');

    try {
      var result = await pull();
      if (result.needPush || dirty) {
        await push(0);
      }
      setStatus('idle');
    } catch (error) {
      handleError(error, options);
    } finally {
      busy = false;
      if (queued) {
        queued = false;
        syncNow({ silent: true });
      }
    }
  }

  function schedulePush(delay) {
    if (!config) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushNow({ silent: true });
    }, typeof delay === 'number' ? delay : PUSH_DELAY);
  }

  function maybePull() {
    if (!config || busy) return;
    if (document.visibilityState && document.visibilityState !== 'visible') return;
    var now = Date.now();
    if (now - lastPullAt < PULL_THROTTLE) return;
    lastPullAt = now;
    syncNow({ silent: true });
  }

  /* ============================================================
   * 状态 / 错误
   * ============================================================ */
  function fmtTime(timestamp) {
    var date = new Date(timestamp);
    return String(date.getHours()).padStart(2, '0') + ':' +
      String(date.getMinutes()).padStart(2, '0');
  }

  function setStatus(kind) {
    statusKind = kind;
    if (kind === 'idle') lastError = '';
    updateStatusUI();
  }

  function handleError(error, options) {
    lastError = error && error.name === 'SyncError'
      ? error.message
      : friendlyNetworkError(error);
    statusKind = 'error';
    updateStatusUI();
    if (!options || !options.silent) {
      if (window.DMHighlights) window.DMHighlights.toast(lastError);
    }
  }

  function updateStatusUI() {
    if (!syncBox) return;

    var state = syncBox.querySelector('.dm-hl-sync-state');
    var detail = syncBox.querySelector('[data-role="sync-detail"]');

    var label = '未开启';
    if (config) {
      if (statusKind === 'syncing') label = '同步中…';
      else if (statusKind === 'error') label = '同步失败';
      else if (config.lastSync) label = '已同步';
      else label = '已开启';
    }

    if (state) {
      state.textContent = label;
      state.className = 'dm-hl-sync-state' +
        (statusKind === 'error' ? ' error' : statusKind === 'syncing' ? ' syncing' : '');
    }

    if (detail) {
      var text = '';
      if (config) {
        if (statusKind === 'error' && lastError) text = lastError;
        else if (statusKind === 'syncing') text = '正在与云端同步…';
        else if (config.lastSync) text = '上次同步 ' + fmtTime(config.lastSync);
        else text = '等待首次同步';
      }
      detail.textContent = text;
      detail.className = 'dm-hl-sync-detail' + (statusKind === 'error' ? ' error' : '');
    }
  }

  /* ============================================================
   * 同步面板
   * ============================================================ */
  var SYNC_CSS = [
    '.dm-hl-sync{display:flex;flex-direction:column;gap:7px;padding:10px 14px 12px;border-top:1px solid var(--border,#e5e7eb);}',
    '.dm-hl-sync-head{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:700;}',
    '.dm-hl-sync-state{font-weight:400;color:var(--text-muted,#999);font-size:11.5px;}',
    '.dm-hl-sync-state.syncing{color:var(--accent,#ea6f5a);}',
    '.dm-hl-sync-state.error{color:var(--red,#e74c3c);}',
    '.dm-hl-sync-actions{display:flex;gap:6px;flex-wrap:wrap;}',
    '.dm-hl-sync-actions .dm-hl-btn{flex:1;min-width:78px;}',
    '.dm-hl-sync-link,.dm-hl-sync-input{display:flex;gap:6px;align-items:center;}',
    '.dm-hl-sync-link input,.dm-hl-sync-input input{flex:1;min-width:0;background:var(--bg,#f9f9f9);color:var(--text,#2f2f2f);border:1px solid var(--border,#e5e7eb);border-radius:7px;padding:6px 8px;font:inherit;font-size:11.5px;outline:none;}',
    '.dm-hl-sync-link input:focus,.dm-hl-sync-input input:focus{border-color:var(--accent,#ea6f5a);}',
    '.dm-hl-sync-detail,.dm-hl-sync-hint{font-size:11px;line-height:1.6;color:var(--text-muted,#999);word-break:break-word;}',
    '.dm-hl-sync-detail.error{color:var(--red,#e74c3c);}',
    '@media(max-width:600px){.dm-hl-sync-actions .dm-hl-btn{min-width:0;}}'
  ].join('');

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function mount() {
    var ui = window.DMHighlights && window.DMHighlights.getUI
      ? window.DMHighlights.getUI()
      : null;
    if (!ui || !ui.panel || !ui.shadow) return;
    if (ui.shadow.querySelector('[data-role="sync"]')) return;

    var style = document.createElement('style');
    style.textContent = SYNC_CSS;
    ui.shadow.appendChild(style);

    syncBox = document.createElement('div');
    syncBox.className = 'dm-hl-sync';
    syncBox.setAttribute('data-role', 'sync');

    var foot = ui.panel.querySelector('.dm-hl-panel-foot');
    if (foot) ui.panel.insertBefore(syncBox, foot);
    else ui.panel.appendChild(syncBox);

    syncBox.addEventListener('click', onSyncClick);
    syncBox.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && event.target.matches('[data-sync-input]')) {
        event.preventDefault();
        connectFromInput();
      }
    });

    renderSyncUI();
  }

  function renderSyncUI() {
    if (!syncBox) return;

    var html;
    if (config) {
      html =
        '<div class="dm-hl-sync-head"><span>同步</span><span class="dm-hl-sync-state"></span></div>' +
        '<div class="dm-hl-sync-actions">' +
          '<button type="button" class="dm-hl-btn" data-sync="now">立即同步</button>' +
          '<button type="button" class="dm-hl-btn" data-sync="copy">复制链接</button>' +
          '<button type="button" class="dm-hl-btn danger" data-sync="off">关闭</button>' +
        '</div>' +
        (setupLink
          ? '<div class="dm-hl-sync-link">' +
              '<input type="text" readonly value="' + esc(setupLink) + '">' +
              '<button type="button" class="dm-hl-btn" data-sync="copy">复制</button>' +
            '</div>' +
            '<div class="dm-hl-sync-hint">在手机浏览器打开这个链接完成配对。</div>'
          : '') +
        '<div class="dm-hl-sync-detail" data-role="sync-detail"></div>' +
        '<div class="dm-hl-sync-hint">端到端加密，云端只保存密文。</div>';
    } else {
      html =
        '<div class="dm-hl-sync-head"><span>同步</span><span class="dm-hl-sync-state"></span></div>' +
        '<div class="dm-hl-sync-actions">' +
          '<button type="button" class="dm-hl-btn" data-sync="create">生成同步码</button>' +
          '<button type="button" class="dm-hl-btn" data-sync="input">输入同步码</button>' +
        '</div>' +
        (inputOpen
          ? '<div class="dm-hl-sync-input">' +
              '<input type="text" data-sync-input placeholder="粘贴同步码或链接" autocomplete="off" spellcheck="false">' +
              '<button type="button" class="dm-hl-btn" data-sync="connect">连接</button>' +
            '</div>'
          : '') +
        (setupLink
          ? '<div class="dm-hl-sync-link">' +
              '<input type="text" readonly value="' + esc(setupLink) + '">' +
              '<button type="button" class="dm-hl-btn" data-sync="copy">复制</button>' +
            '</div>' +
            '<div class="dm-hl-sync-hint">在手机浏览器打开这个链接完成配对。</div>'
          : '') +
        '<div class="dm-hl-sync-detail" data-role="sync-detail"></div>' +
        '<div class="dm-hl-sync-hint">开启后，高亮会加密同步到云端。</div>';
    }

    syncBox.innerHTML = html;
    updateStatusUI();

    if (inputOpen) {
      var input = syncBox.querySelector('[data-sync-input]');
      if (input) input.focus();
    }
  }

  function onSyncClick(event) {
    var button = event.target.closest('[data-sync]');
    if (!button) return;
    var action = button.getAttribute('data-sync');

    if (action === 'create') {
      createVault();
      return;
    }
    if (action === 'input') {
      inputOpen = !inputOpen;
      setupLink = '';
      renderSyncUI();
      return;
    }
    if (action === 'connect') {
      connectFromInput();
      return;
    }
    if (action === 'copy') {
      copyPairLink();
      return;
    }
    if (action === 'now') {
      syncNow({ silent: false });
      return;
    }
    if (action === 'off') {
      disableSync();
      return;
    }
  }

  function createVault() {
    if (!cryptoAvailable()) {
      window.DMHighlights.toast('当前环境不支持加密同步，请使用 HTTPS 打开页面');
      return;
    }
    config = {
      v: 1,
      vaultId: b64urlEncode(randomBytes(16)),
      secret: b64urlEncode(randomBytes(32)),
      token: '',
      rev: 0,
      lastSync: 0,
      endpoint: ENDPOINT
    };
    keyCache = null;
    lastError = '';
    inputOpen = false;
    setupLink = pairLink();
    saveConfig();
    renderSyncUI();
    syncNow({ silent: false });
  }

  function connectFromInput() {
    var input = syncBox ? syncBox.querySelector('[data-sync-input]') : null;
    var parsed = parseCode(input ? input.value : '');
    if (!parsed) {
      window.DMHighlights.toast('同步码格式不正确，请检查链接或同步码');
      return;
    }
    if (config && !window.confirm('替换当前同步码？本地数据会合并到新的同步空间。')) {
      return;
    }
    config = {
      v: 1,
      vaultId: parsed.vaultId,
      secret: parsed.secret,
      token: '',
      rev: 0,
      lastSync: 0,
      endpoint: ENDPOINT
    };
    keyCache = null;
    lastError = '';
    inputOpen = false;
    setupLink = '';
    saveConfig();
    renderSyncUI();
    syncNow({ silent: false });
  }

  function copyPairLink() {
    var link = setupLink || pairLink();
    if (!link) return;
    var done = function () { window.DMHighlights.toast('同步链接已复制'); };
    var fallback = function () { window.prompt('复制同步链接', link); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(link).then(done, fallback);
    } else {
      fallback();
    }
  }

  function disableSync() {
    if (!window.confirm('关闭同步？本地高亮不会删除，但之后不再与云端同步。')) return;
    config = null;
    keyCache = null;
    lastError = '';
    statusKind = 'idle';
    setupLink = '';
    inputOpen = false;
    clearTimeout(pushTimer);
    saveConfig();
    renderSyncUI();
    window.DMHighlights.toast('已关闭同步，本地数据保留');
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function bind() {
    window.addEventListener('dm-hl-changed', function () {
      if (!config) return;
      dirty = true;
      schedulePush(PUSH_DELAY);
    });

    window.addEventListener('storage', function (event) {
      if (event.key !== CONFIG_KEY) return;
      var old = config;
      config = loadConfig();
      keyCache = null;
      setupLink = '';

      if (config &&
          (!old || old.vaultId !== config.vaultId || old.secret !== config.secret)) {
        lastError = '';
        renderSyncUI();
        syncNow({ silent: true });
      } else {
        renderSyncUI();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') maybePull();
    });

    window.addEventListener('focus', maybePull);
    window.addEventListener('online', function () {
      if (config) syncNow({ silent: true });
    });
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    storePrefix = window.DMHighlights.getStorePrefix();
    config = loadConfig();
    var paired = consumeHash();

    mount();
    bind();
    renderSyncUI();

    if (paired) {
      window.DMHighlights.toast('已连接同步，正在拉取…');
    }

    if (config) {
      setStatus('idle');
      // 避免初始化同步和紧接着的 focus/visibility 事件重复触发
      lastPullAt = Date.now();
      setTimeout(function () {
        syncNow({ silent: true });
      }, 700);
    }
  }

  // 调试/自动化接口（不涉及新的权限；密钥本来就在 localStorage 中）
  window.DMSync = {
    version: 1,
    getConfig: function () {
      return config ? JSON.parse(JSON.stringify(config)) : null;
    },
    syncNow: function () { return syncNow({ silent: true }); },
    pushNow: function () { return pushNow({ silent: true }); },
    setRev: function (rev) {
      if (!config) return;
      config.rev = Number(rev) || 0;
      saveConfig();
    },
    pull: pull,
    buildLocalDoc: buildLocalDoc,
    mergeDocs: mergeDocs,
    encryptDoc: encryptDoc,
    decryptDoc: decryptDoc
  };

  if (window.DMHighlights) {
    window.DMHighlights.ready(init);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      if (window.DMHighlights) window.DMHighlights.ready(init);
    });
  }
})();
