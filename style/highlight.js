/* ============================================================
 * 站内高亮笔记（MVP）
 * - 选中文字后出现浮动工具条，可标黄 / 绿 / 红 / 蓝并添加备注
 * - 也支持右键（站内自绘菜单）
 * - 数据保存在当前域名的 localStorage，按页面路径隔离
 * - 打开页面自动恢复；支持本页清空、全站导出 / 导入
 * 依赖：style/highlight.css
 * ============================================================ */
(function () {
  'use strict';

  if (window.__dmHighlightLoaded) return;
  window.__dmHighlightLoaded = true;
  if (window.top !== window.self) return;

  var STORE_PREFIX = 'dm-hl:v1:';
  var COLORS = ['yellow', 'green', 'red', 'blue'];
  var COLOR_NAMES = { yellow: '黄色', green: '绿色', red: '红色', blue: '蓝色' };
  var ROOT_SELECTORS = [
    '.article-body',
    'main .content',
    'main',
    'article',
    '.card',
    '.container',
    '.g1-detail',
    'body'
  ];
  var EXCLUDE_SELECTOR = [
    'script', 'style', 'noscript', 'nav', '.top-nav', '.toc-sidebar',
    'footer', '.footer', '.back-to-top', '.dm-theme-toggle', '#dm-hl-ui',
    '.mermaid', 'svg'
  ].join(',');

  // 这些区域的内容不进入文本锚点，避免 Mermaid 等动态渲染改变偏移
  var MAP_SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'svg', '.mermaid',
    'nav', '.top-nav', '.toc-sidebar', 'footer', '.footer',
    '.back-to-top', '.dm-theme-toggle', '#dm-hl-ui'
  ].join(',');

  /* ---------- 基础信息 ---------- */
  function pageUrl() {
    var u = location.protocol === 'file:'
      ? 'file://' + location.pathname
      : location.origin + location.pathname;
    return (u || location.href).replace(/#.*$/, '');
  }

  var PAGE_URL = pageUrl();
  var PAGE_KEY = STORE_PREFIX + PAGE_URL;

  var state = { v: 1, url: PAGE_URL, highlights: [] };
  var pending = null;          // 待创建高亮的锚点
  var editing = null;          // { mode: 'create' | 'edit', id, color }
  var ui = {};
  var toastTimer = null;

  /* ============================================================
   * 存储
   * ============================================================ */
  function load() {
    try {
      var raw = localStorage.getItem(PAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data && Array.isArray(data.highlights)) {
        state = { v: 1, url: PAGE_URL, highlights: data.highlights };
      }
    } catch (e) { /* 数据损坏时从空开始 */ }
  }

  function save() {
    try {
      localStorage.setItem(PAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast('保存失败：浏览器本地存储空间不足');
    }
  }

  function newId() {
    return 'hl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function findHighlight(id) {
    for (var i = 0; i < state.highlights.length; i++) {
      if (state.highlights[i].id === id) return state.highlights[i];
    }
    return null;
  }

  /* ============================================================
   * 文本锚点
   * ============================================================ */
  function isExcluded(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    if (!el) return true;
    return !!el.closest(EXCLUDE_SELECTOR);
  }

  function findRoot(node) {
    var el = node && node.nodeType === 1 ? node : (node && node.parentElement);
    if (!el) return document.body;
    for (var i = 0; i < ROOT_SELECTORS.length; i++) {
      var root = el.closest(ROOT_SELECTORS[i]);
      if (root) return root;
    }
    return document.body;
  }

  function selectorFor(root) {
    if (!root || root === document.body) return 'body';
    for (var i = 0; i < ROOT_SELECTORS.length; i++) {
      try {
        if (root.matches(ROOT_SELECTORS[i])) return ROOT_SELECTORS[i];
      } catch (e) { /* 忽略非法选择器 */ }
    }
    return 'body';
  }

  function rootIndex(root, selector) {
    if (!root || !selector) return 0;
    try {
      return Array.prototype.indexOf.call(document.querySelectorAll(selector), root);
    } catch (e) {
      return 0;
    }
  }

  function buildTextMap(root) {
    var nodes = [];
    var parts = [];
    var pos = 0;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null, false);
    var node;
    while ((node = walker.nextNode())) {
      var value = node.nodeValue;
      if (!value) continue;
      var parent = node.parentElement;
      if (parent && parent.closest(MAP_SKIP_SELECTOR)) continue;
      nodes.push({ node: node, start: pos, end: pos + value.length });
      parts.push(value);
      pos += value.length;
    }
    return { root: root, nodes: nodes, text: parts.join('') };
  }

  function offsetOfBoundary(map, node, offset) {
    if (node && node.nodeType === 3) {
      for (var i = 0; i < map.nodes.length; i++) {
        if (map.nodes[i].node === node) {
          var max = node.nodeValue ? node.nodeValue.length : 0;
          return map.nodes[i].start + Math.max(0, Math.min(offset, max));
        }
      }
    }
    // 元素边界（例如三击选中整段）：计算边界之前的文本总长度
    var boundary = document.createRange();
    try {
      boundary.setStart(node, offset);
      boundary.collapse(true);
    } catch (e) {
      return null;
    }
    var total = 0;
    for (var j = 0; j < map.nodes.length; j++) {
      var entry = map.nodes[j];
      var nodeRange = document.createRange();
      nodeRange.selectNodeContents(entry.node);
      if (boundary.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0) {
        total = entry.end;
      } else {
        break;
      }
    }
    return total;
  }

  function buildAnchor() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
    var range = sel.getRangeAt(0);
    if (!range.toString().trim()) return null;
    if (isExcluded(range.startContainer) || isExcluded(range.endContainer)) return null;

    var root = findRoot(range.startContainer);
    if (!root || !root.contains(range.endContainer)) root = document.body;

    var map = buildTextMap(root);
    var start = offsetOfBoundary(map, range.startContainer, range.startOffset);
    var end = offsetOfBoundary(map, range.endContainer, range.endOffset);
    if (start == null || end == null || end <= start) return null;
    if (end > map.text.length) end = map.text.length;

    var raw = map.text.slice(start, end);
    var lead = raw.length - raw.replace(/^\s+/, '').length;
    var trail = raw.length - raw.replace(/\s+$/, '').length;
    start += lead;
    end -= trail;
    if (end <= start) return null;

    var quote = map.text.slice(start, end);
    var selector = selectorFor(root);

    return {
      rootSel: selector,
      rootIndex: rootIndex(root, selector),
      start: start,
      end: end,
      quote: quote,
      prefix: map.text.slice(Math.max(0, start - 40), start),
      suffix: map.text.slice(end, Math.min(map.text.length, end + 40))
    };
  }

  function rootCandidates(anchor) {
    var list = [];
    if (anchor.rootSel) {
      try {
        var nodes = Array.prototype.slice.call(document.querySelectorAll(anchor.rootSel));
        var preferred = nodes[anchor.rootIndex];
        if (preferred) list.push(preferred);
        nodes.forEach(function (node) {
          if (list.indexOf(node) === -1) list.push(node);
        });
      } catch (e) { /* 忽略 */ }
    }
    if (list.indexOf(document.body) === -1) list.push(document.body);
    return list;
  }

  function findQuote(text, anchor) {
    var quote = anchor.quote;
    if (!quote) return -1;
    var best = -1;
    var bestScore = -Infinity;
    var index = text.indexOf(quote);
    var tries = 0;
    while (index !== -1 && tries < 200) {
      tries++;
      var score = 0;
      if (anchor.prefix && text.slice(Math.max(0, index - anchor.prefix.length), index) === anchor.prefix) score += 2;
      if (anchor.suffix && text.substr(index + quote.length, anchor.suffix.length) === anchor.suffix) score += 2;
      if (typeof anchor.start === 'number') {
        score -= Math.min(Math.abs(index - anchor.start) / 800, 1.5);
      }
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
      index = text.indexOf(quote, index + 1);
    }
    return best;
  }

  function locate(anchor) {
    if (!anchor || !anchor.quote) return null;
    var candidates = rootCandidates(anchor);
    for (var i = 0; i < candidates.length; i++) {
      var root = candidates[i];
      if (!root || !root.isConnected) continue;
      var map = buildTextMap(root);
      var start = anchor.start;
      if (typeof start === 'number' && start >= 0 &&
          start + anchor.quote.length <= map.text.length &&
          map.text.substr(start, anchor.quote.length) === anchor.quote) {
        return { root: root, map: map, start: start, end: start + anchor.quote.length, moved: false };
      }
      var found = findQuote(map.text, anchor);
      if (found !== -1) {
        return { root: root, map: map, start: found, end: found + anchor.quote.length, moved: true };
      }
    }
    return null;
  }

  function removeMarks() {
    var mark;
    while ((mark = document.querySelector('mark.dm-hl'))) {
      var parent = mark.parentNode;
      if (!parent) break;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
    if (document.body) document.body.normalize();
  }

  function wrapHighlight(highlight, location) {
    var color = COLORS.indexOf(highlight.color) === -1 ? 'yellow' : highlight.color;
    var segments = [];
    location.map.nodes.forEach(function (entry) {
      var start = Math.max(location.start, entry.start);
      var end = Math.min(location.end, entry.end);
      if (end > start) {
        segments.push({ node: entry.node, start: start - entry.start, end: end - entry.start });
      }
    });

    segments.forEach(function (seg) {
      var node = seg.node;
      if (!node || !node.parentNode) return;
      if (seg.end <= seg.start || seg.end > (node.nodeValue || '').length) return;
      var existing = node.parentElement && node.parentElement.closest('mark.dm-hl');
      if (existing && existing.getAttribute('data-hl-id') === highlight.id) return;

      var range = document.createRange();
      try {
        range.setStart(node, seg.start);
        range.setEnd(node, seg.end);
      } catch (e) {
        return;
      }

      var mark = document.createElement('mark');
      mark.className = 'dm-hl dm-hl-' + color + (highlight.note ? ' has-note' : '');
      mark.setAttribute('data-hl-id', highlight.id);
      if (highlight.note) mark.title = highlight.note;
      try {
        range.surroundContents(mark);
      } catch (e) { /* 跨节点等极端情况直接跳过 */ }
    });
  }

  function renderAll() {
    removeMarks();
    var changed = false;
    var ordered = state.highlights.slice().sort(function (a, b) {
      return (a.anchor && a.anchor.start || 0) - (b.anchor && b.anchor.start || 0);
    });

    ordered.forEach(function (highlight) {
      if (!highlight.anchor || !highlight.anchor.quote) {
        highlight._missing = true;
        return;
      }
      var location = locate(highlight.anchor);
      if (!location) {
        highlight._missing = true;
        return;
      }
      highlight._missing = false;

      var selector = selectorFor(location.root);
      if (location.moved ||
          highlight.anchor.start !== location.start ||
          highlight.anchor.end !== location.end ||
          highlight.anchor.rootSel !== selector ||
          highlight.anchor.rootIndex !== rootIndex(location.root, selector)) {
        highlight.anchor.start = location.start;
        highlight.anchor.end = location.end;
        highlight.anchor.rootSel = selector;
        highlight.anchor.rootIndex = rootIndex(location.root, selector);
        highlight.anchor.prefix = location.map.text.slice(Math.max(0, location.start - 40), location.start);
        highlight.anchor.suffix = location.map.text.slice(location.end, Math.min(location.map.text.length, location.end + 40));
        changed = true;
      }
      wrapHighlight(highlight, location);
    });

    if (changed) save();
    updatePanel();
  }

  /* ============================================================
   * 创建 / 编辑
   * ============================================================ */
  function addHighlight(anchor, color, note) {
    var now = Date.now();
    var highlight = {
      id: newId(),
      color: COLORS.indexOf(color) === -1 ? 'yellow' : color,
      quote: anchor.quote,
      note: note || '',
      anchor: {
        rootSel: anchor.rootSel,
        rootIndex: anchor.rootIndex,
        start: anchor.start,
        end: anchor.end,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix
      },
      createdAt: now,
      updatedAt: now
    };
    state.highlights.push(highlight);
    save();
    renderAll();
    return highlight;
  }

  function updateHighlight(id, patch) {
    var highlight = findHighlight(id);
    if (!highlight) return;
    Object.keys(patch).forEach(function (key) { highlight[key] = patch[key]; });
    highlight.updatedAt = Date.now();
    save();
    renderAll();
  }

  function deleteHighlight(id) {
    state.highlights = state.highlights.filter(function (h) { return h.id !== id; });
    save();
    renderAll();
  }

  /* ============================================================
   * 界面（Shadow DOM）
   * ============================================================ */
  var UI_CSS = [
    ':host{all:initial;position:fixed;inset:0;z-index:2147483000;pointer-events:none}',
    '*{box-sizing:border-box}',
    '[hidden]{display:none!important}',
    '.dm-hl-bar,.dm-hl-menu,.dm-hl-editor,.dm-hl-panel,.dm-hl-fab,.dm-hl-toast{pointer-events:auto;color:var(--text,#2f2f2f);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;}',
    '.dm-hl-bar,.dm-hl-menu,.dm-hl-editor,.dm-hl-panel{position:fixed;background:var(--card-bg,#fff);border:1px solid var(--border,#e5e7eb);border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.18);}',
    '.dm-hl-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:13px;white-space:nowrap;}',
    '.dm-hl-menu{padding:8px;min-width:210px;}',
    '.dm-hl-menu-title{font-size:11px;font-weight:700;color:var(--text-muted,#999);letter-spacing:.5px;padding:2px 6px 6px;}',
    '.dm-hl-row{display:flex;align-items:center;gap:8px;padding:2px 4px;}',
    '.dm-hl-dot{width:24px;height:24px;border-radius:50%;border:2px solid rgba(0,0,0,.08);cursor:pointer;padding:0;flex:none;transition:transform .12s ease,box-shadow .12s ease;}',
    '.dm-hl-dot:hover{transform:scale(1.12);}',
    '.dm-hl-dot.selected{box-shadow:0 0 0 2px var(--card-bg,#fff),0 0 0 4px var(--accent,#ea6f5a);}',
    '.dm-hl-dot.yellow{background:#ffd60a}',
    '.dm-hl-dot.green{background:#4ade80}',
    '.dm-hl-dot.red{background:#f87171}',
    '.dm-hl-dot.blue{background:#60a5fa}',
    '.dm-hl-sep{width:1px;height:18px;background:var(--border,#e5e7eb);margin:0 2px;}',
    '.dm-hl-btn{appearance:none;border:1px solid var(--border,#e5e7eb);background:transparent;color:var(--text-secondary,#666);border-radius:8px;padding:5px 10px;font:inherit;font-size:12.5px;cursor:pointer;transition:all .15s ease;}',
    '.dm-hl-btn:hover{border-color:var(--accent,#ea6f5a);color:var(--accent,#ea6f5a);}',
    '.dm-hl-btn.primary{background:var(--accent,#ea6f5a);border-color:var(--accent,#ea6f5a);color:#fff;font-weight:600;}',
    '.dm-hl-btn.primary:hover{background:var(--accent-hover,#ec6149);border-color:var(--accent-hover,#ec6149);color:#fff;}',
    '.dm-hl-btn.danger{color:var(--red,#e74c3c);border-color:rgba(231,76,60,.35);}',
    '.dm-hl-btn.danger:hover{background:rgba(231,76,60,.1);border-color:var(--red,#e74c3c);color:var(--red,#e74c3c);}',
    '.dm-hl-editor{width:320px;max-width:calc(100vw - 24px);padding:14px;}',
    '.dm-hl-editor-title{font-size:13px;font-weight:700;margin-bottom:10px;}',
    '.dm-hl-editor textarea{width:100%;min-height:66px;resize:vertical;background:var(--bg,#f9f9f9);color:var(--text,#2f2f2f);border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;line-height:1.6;outline:none;}',
    '.dm-hl-editor textarea:focus{border-color:var(--accent,#ea6f5a);}',
    '.dm-hl-editor-actions{display:flex;align-items:center;gap:8px;margin-top:10px;}',
    '.dm-hl-editor-actions .spacer{flex:1}',
    '.dm-hl-fab{position:fixed;right:40px;bottom:104px;width:46px;height:46px;border-radius:50%;border:1px solid var(--border,#e5e7eb);background:var(--card-bg,#fff);box-shadow:0 4px 16px rgba(0,0,0,.16);font-size:20px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}',
    '.dm-hl-fab:hover{border-color:var(--accent,#ea6f5a);}',
    '.dm-hl-fab .count{position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--accent,#ea6f5a);color:#fff;font-size:11px;font-weight:700;line-height:18px;text-align:center;}',
    '.dm-hl-panel{right:40px;bottom:166px;width:370px;max-width:calc(100vw - 24px);max-height:60vh;display:flex;flex-direction:column;overflow:hidden;}',
    '.dm-hl-panel-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border,#e5e7eb);font-size:13px;font-weight:700;}',
    '.dm-hl-panel-head .dm-hl-count{font-weight:400;color:var(--text-muted,#999);font-size:12px;}',
    '.dm-hl-panel-head .close{margin-left:auto;border:0;background:transparent;color:var(--text-muted,#999);font-size:18px;line-height:1;cursor:pointer;padding:2px 4px;}',
    '.dm-hl-list{overflow-y:auto;padding:6px 0;flex:1;}',
    '.dm-hl-empty{padding:26px 16px;text-align:center;color:var(--text-muted,#999);font-size:12.5px;line-height:1.7;}',
    '.dm-hl-item{display:flex;gap:9px;padding:9px 14px;cursor:pointer;border-left:3px solid transparent;}',
    '.dm-hl-item:hover{background:rgba(127,127,127,.08);}',
    '.dm-hl-item .sw{width:10px;height:10px;border-radius:3px;flex:none;margin-top:5px;}',
    '.dm-hl-item .body{flex:1;min-width:0;}',
    '.dm-hl-item .quote{font-size:12.5px;line-height:1.55;color:var(--text,#2f2f2f);word-break:break-word;}',
    '.dm-hl-item .note{font-size:11.5px;line-height:1.5;color:var(--text-muted,#999);margin-top:3px;word-break:break-word;}',
    '.dm-hl-item .missing{font-size:11px;color:var(--red,#e74c3c);margin-top:3px;}',
    '.dm-hl-item .del{border:0;background:transparent;color:var(--text-muted,#999);font-size:15px;line-height:1;cursor:pointer;padding:0 2px;flex:none;align-self:flex-start;}',
    '.dm-hl-item .del:hover{color:var(--red,#e74c3c);}',
    '.dm-hl-item .sw.yellow{background:#ffd60a}.dm-hl-item .sw.green{background:#4ade80}.dm-hl-item .sw.red{background:#f87171}.dm-hl-item .sw.blue{background:#60a5fa}',
    '.dm-hl-panel-foot{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--border,#e5e7eb);flex-wrap:wrap;}',
    '.dm-hl-panel-foot .dm-hl-btn{flex:1;white-space:nowrap;}',
    '.dm-hl-toast{position:fixed;left:50%;bottom:32px;transform:translateX(-50%);background:rgba(32,32,32,.92);color:#fff;padding:9px 16px;border-radius:20px;font-size:12.5px;line-height:1.4;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:calc(100vw - 32px);text-align:center;}',
    '@media(max-width:600px){.dm-hl-fab{right:16px;bottom:84px;width:44px;height:44px}.dm-hl-panel{left:12px;right:12px;bottom:140px;width:auto;max-height:56vh}.dm-hl-editor{width:calc(100vw - 24px)}}'
  ].join('');

  function buildDot(color) {
    return '<button type="button" class="dm-hl-dot ' + color + '" data-action="color" data-color="' + color + '" title="' + COLOR_NAMES[color] + '高亮" aria-label="' + COLOR_NAMES[color] + '高亮"></button>';
  }

  function ensureUI() {
    if (document.getElementById('dm-hl-ui')) return;

    var host = document.createElement('div');
    host.id = 'dm-hl-ui';
    var shadow = host.attachShadow({ mode: 'open' });
    var style = document.createElement('style');
    style.textContent = UI_CSS;
    shadow.appendChild(style);

    var dots = COLORS.map(buildDot).join('');

    var bar = document.createElement('div');
    bar.className = 'dm-hl-bar';
    bar.hidden = true;
    bar.innerHTML = dots + '<span class="dm-hl-sep"></span>' +
      '<button type="button" class="dm-hl-btn" data-action="note">备注</button>';

    var menu = document.createElement('div');
    menu.className = 'dm-hl-menu';
    menu.hidden = true;
    menu.innerHTML = '<div class="dm-hl-menu-title">高亮选中文字</div><div class="dm-hl-row">' + dots +
      '<span class="dm-hl-sep"></span><button type="button" class="dm-hl-btn" data-action="note">备注…</button></div>';

    var editor = document.createElement('div');
    editor.className = 'dm-hl-editor';
    editor.hidden = true;
    editor.innerHTML =
      '<div class="dm-hl-editor-title">高亮笔记</div>' +
      '<div class="dm-hl-row" data-role="colors" style="margin-bottom:10px">' + dots + '</div>' +
      '<textarea data-role="note" placeholder="写点笔记（可选）"></textarea>' +
      '<div class="dm-hl-editor-actions">' +
        '<button type="button" class="dm-hl-btn danger" data-action="delete" hidden>删除</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="dm-hl-btn" data-action="cancel">取消</button>' +
        '<button type="button" class="dm-hl-btn primary" data-action="save">保存</button>' +
      '</div>';

    var panel = document.createElement('div');
    panel.className = 'dm-hl-panel';
    panel.hidden = true;
    panel.innerHTML =
      '<div class="dm-hl-panel-head">本页高亮 <span class="dm-hl-count" data-role="count"></span>' +
        '<button type="button" class="close" data-action="close-panel" title="关闭" aria-label="关闭">×</button>' +
      '</div>' +
      '<div class="dm-hl-list" data-role="list"></div>' +
      '<div class="dm-hl-panel-foot">' +
        '<button type="button" class="dm-hl-btn" data-action="export">导出全部</button>' +
        '<button type="button" class="dm-hl-btn" data-action="import">导入</button>' +
        '<button type="button" class="dm-hl-btn danger" data-action="clear">清空本页</button>' +
      '</div>';

    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.hidden = true;

    var fab = document.createElement('button');
    fab.type = 'button';
    fab.className = 'dm-hl-fab';
    fab.title = '高亮笔记';
    fab.setAttribute('aria-label', '打开高亮笔记面板');
    fab.innerHTML = '🖍<span class="count" data-role="fab-count"></span>';

    var toastEl = document.createElement('div');
    toastEl.className = 'dm-hl-toast';
    toastEl.hidden = true;

    shadow.appendChild(bar);
    shadow.appendChild(menu);
    shadow.appendChild(editor);
    shadow.appendChild(panel);
    shadow.appendChild(fab);
    shadow.appendChild(toastEl);
    shadow.appendChild(fileInput);
    document.body.appendChild(host);

    ui = {
      host: host,
      shadow: shadow,
      bar: bar,
      menu: menu,
      editor: editor,
      panel: panel,
      fab: fab,
      toastEl: toastEl,
      fileInput: fileInput,
      noteInput: editor.querySelector('[data-role="note"]')
    };

    // 防止点击工具条时清空选区
    shadow.addEventListener('mousedown', function (event) {
      if (event.target.closest('.dm-hl-bar, .dm-hl-menu') && event.target.closest('button')) {
        event.preventDefault();
      }
    });
    shadow.addEventListener('click', onUiClick);

    fab.addEventListener('click', function () {
      if (panel.hidden) openPanel(); else closePanel();
    });
    fileInput.addEventListener('change', onImportFile);
  }

  function onUiClick(event) {
    var target = event.target.closest('[data-action], [data-hl-id], .dm-hl-item');
    if (!target) return;
    var action = target.getAttribute('data-action');

    if (target.classList.contains('dm-hl-dot') && !action) action = 'color';
    if (target.classList.contains('dm-hl-item')) action = 'item';

    if (action === 'color') {
      var color = target.getAttribute('data-color');
      if (editing) {
        editing.color = color;
        syncEditorColors();
      } else if (pending) {
        addHighlight(pending, color, '');
        pending = null;
        hideBar();
        hideMenu();
        clearSelection();
        toast('已添加' + COLOR_NAMES[color] + '高亮');
      }
      return;
    }

    if (action === 'note') {
      if (pending) openEditor('create', null);
      return;
    }

    if (action === 'save') {
      var note = (ui.noteInput.value || '').trim();
      if (editing && editing.mode === 'create' && pending) {
        var created = addHighlight(pending, editing.color, note);
        pending = null;
        closeEditor();
        clearSelection();
        toast(note ? '已添加高亮和笔记' : '已添加高亮');
        setTimeout(function () { flashMark(created.id); }, 0);
      } else if (editing && editing.mode === 'edit' && editing.id) {
        updateHighlight(editing.id, { color: editing.color, note: note });
        closeEditor();
        toast('已保存');
      }
      return;
    }

    if (action === 'delete') {
      if (editing && editing.mode === 'edit' && editing.id) {
        if (!window.confirm('删除这条高亮及笔记？')) return;
        deleteHighlight(editing.id);
        closeEditor();
        toast('已删除');
      }
      return;
    }

    if (action === 'cancel') { closeEditor(); return; }
    if (action === 'close-panel') { closePanel(); return; }

    if (action === 'clear') {
      if (!state.highlights.length) { toast('本页还没有高亮'); return; }
      if (!window.confirm('清空本页全部高亮和笔记？此操作不可撤销。')) return;
      state.highlights = [];
      save();
      renderAll();
      toast('本页高亮已清空');
      return;
    }

    if (action === 'export') { exportAll(); return; }
    if (action === 'import') { ui.fileInput.click(); return; }

    if (action === 'item') {
      var id = target.getAttribute('data-id');
      if (id) {
        var mark = document.querySelector('mark.dm-hl[data-hl-id="' + id + '"]');
        if (mark) {
          mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
          flashMark(id);
        } else {
          toast('原文位置未找到，可能页面内容已变更');
        }
      }
      return;
    }

    if (target.hasAttribute('data-hl-id') && action === 'delete-item') {
      event.stopPropagation();
      deleteHighlight(target.getAttribute('data-hl-id'));
      return;
    }
  }

  function syncEditorColors() {
    if (!editing) return;
    Array.prototype.forEach.call(ui.editor.querySelectorAll('.dm-hl-dot'), function (dot) {
      dot.classList.toggle('selected', dot.getAttribute('data-color') === editing.color);
    });
  }

  function openEditor(mode, id) {
    if (!ui.editor) return;
    hideBar();
    hideMenu();

    var highlight = id ? findHighlight(id) : null;
    if (mode === 'edit' && !highlight) return;

    editing = {
      mode: mode,
      id: id || null,
      color: highlight ? highlight.color : 'yellow'
    };

    ui.editor.querySelector('[data-role="colors"]').style.display = '';
    ui.noteInput.value = highlight ? (highlight.note || '') : '';
    ui.editor.querySelector('[data-action="delete"]').hidden = mode !== 'edit';
    ui.editor.querySelector('.dm-hl-editor-title').textContent = mode === 'edit' ? '编辑高亮笔记' : '高亮笔记';
    syncEditorColors();

    var rect;
    if (highlight) {
      var mark = document.querySelector('mark.dm-hl[data-hl-id="' + id + '"]');
      rect = mark ? mark.getBoundingClientRect() : null;
    } else if (pending) {
      var sel = window.getSelection();
      rect = sel && sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
    }

    ui.editor.hidden = false;
    positionNear(ui.editor, rect || { left: innerWidth / 2, top: innerHeight / 2, width: 0, height: 0, bottom: innerHeight / 2 });
    ui.noteInput.focus();
  }

  function closeEditor() {
    if (!ui.editor) return;
    ui.editor.hidden = true;
    editing = null;
    pending = null;
    ui.noteInput.value = '';
  }

  function openPanel() {
    if (!ui.panel) return;
    updatePanel();
    ui.panel.hidden = false;
  }

  function closePanel() {
    if (ui.panel) ui.panel.hidden = true;
  }

  function updatePanel() {
    if (!ui.panel) return;
    var countEl = ui.shadow.querySelector('[data-role="count"]');
    var fabCount = ui.shadow.querySelector('[data-role="fab-count"]');
    var list = ui.shadow.querySelector('[data-role="list"]');
    var count = state.highlights.length;
    countEl.textContent = count ? '（' + count + ' 条）' : '';
    if (fabCount) {
      fabCount.textContent = count ? String(count) : '';
      fabCount.hidden = !count;
    }

    if (!list) return;
    if (!count) {
      list.innerHTML = '<div class="dm-hl-empty">还没有高亮。<br>选中正文文字，选择颜色即可标记。</div>';
      return;
    }

    list.innerHTML = '';
    state.highlights.slice().sort(function (a, b) {
      return (a.anchor.start || 0) - (b.anchor.start || 0);
    }).forEach(function (highlight) {
      var item = document.createElement('div');
      item.className = 'dm-hl-item';
      item.setAttribute('data-action', 'item');
      item.setAttribute('data-id', highlight.id);
      var quote = highlight.quote || '';
      if (quote.length > 90) quote = quote.slice(0, 90) + '…';
      var note = highlight.note || '';
      var esc = function (s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
      };
      item.innerHTML =
        '<span class="sw ' + (highlight.color || 'yellow') + '"></span>' +
        '<div class="body">' +
          '<div class="quote">' + esc(quote) + '</div>' +
          (note ? '<div class="note">' + esc(note) + '</div>' : '') +
          (highlight._missing ? '<div class="missing">原文位置未找到</div>' : '') +
        '</div>' +
        '<button type="button" class="del" data-action="delete-item" data-hl-id="' + highlight.id + '" title="删除" aria-label="删除">×</button>';
      list.appendChild(item);
    });
  }

  function flashMark(id) {
    var mark = document.querySelector('mark.dm-hl[data-hl-id="' + id + '"]');
    if (!mark) return;
    mark.classList.remove('dm-hl-flash');
    void mark.offsetWidth;
    mark.classList.add('dm-hl-flash');
    setTimeout(function () { mark.classList.remove('dm-hl-flash'); }, 1400);
  }

  function toast(message) {
    if (!ui.toastEl) return;
    ui.toastEl.textContent = message;
    ui.toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { ui.toastEl.hidden = true; }, 2200);
  }

  /* ============================================================
   * 选区 / 菜单定位
   * ============================================================ */
  function hideBar() { if (ui.bar) ui.bar.hidden = true; }
  function hideMenu() { if (ui.menu) ui.menu.hidden = true; }

  function positionNear(el, rect) {
    var width = el.offsetWidth;
    var height = el.offsetHeight;
    var left = rect.left + rect.width / 2 - width / 2;
    var top = rect.top - height - 10;
    if (top < 8) top = rect.bottom + 10;
    if (left < 8) left = 8;
    if (left + width > innerWidth - 8) left = innerWidth - width - 8;
    if (top + height > innerHeight - 8) top = innerHeight - height - 8;
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
  }

  function selectionRect() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if ((!rect || (!rect.width && !rect.height)) && range.getClientRects().length) {
      rect = range.getClientRects()[range.getClientRects().length - 1];
    }
    return rect;
  }

  function checkSelection() {
    if (!ui.bar || editing) return;
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) {
      hideBar();
      return;
    }
    var anchor = buildAnchor();
    if (!anchor) {
      hideBar();
      return;
    }
    var rect = selectionRect();
    if (!rect || (!rect.width && !rect.height)) {
      hideBar();
      return;
    }
    pending = anchor;
    ui.bar.hidden = false;
    positionNear(ui.bar, rect);
  }

  function clearSelection() {
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
  }

  function showMenuAt(x, y) {
    if (!ui.menu) return;
    hideBar();
    ui.menu.hidden = false;
    var width = ui.menu.offsetWidth;
    var height = ui.menu.offsetHeight;
    var left = Math.min(x, innerWidth - width - 8);
    var top = Math.min(y, innerHeight - height - 8);
    ui.menu.style.left = Math.max(8, left) + 'px';
    ui.menu.style.top = Math.max(8, top) + 'px';
  }

  /* ============================================================
   * 导入 / 导出
   * ============================================================ */
  function exportAll() {
    var pages = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(STORE_PREFIX) !== 0) continue;
        var raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          var data = JSON.parse(raw);
          if (data && Array.isArray(data.highlights)) {
            pages.push({ key: key, url: data.url || key.slice(STORE_PREFIX.length), highlights: data.highlights });
          }
        } catch (e) { /* 跳过损坏条目 */ }
      }
    } catch (e) {
      toast('读取本地数据失败');
      return;
    }
    if (!pages.length) {
      toast('还没有任何高亮数据');
      return;
    }
    var payload = { v: 1, exportedAt: new Date().toISOString(), pages: pages };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var now = new Date();
    var stamp = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    a.href = url;
    a.download = 'deepmastery-highlights-' + stamp + '.json';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.remove();
    }, 1000);
    toast('已导出 ' + pages.length + ' 个页面的高亮');
  }

  function mergeById(existing, incoming) {
    var map = {};
    (existing || []).forEach(function (h) { if (h && h.id) map[h.id] = h; });
    (incoming || []).forEach(function (h) {
      if (!h || !h.id) return;
      map[h.id] = Object.assign(map[h.id] || {}, h);
    });
    return Object.keys(map).map(function (id) { return map[id]; });
  }

  function onImportFile(event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = '';
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try {
        data = JSON.parse(String(reader.result));
      } catch (e) {
        toast('导入失败：不是有效的 JSON 文件');
        return;
      }
      var imported = 0;

      if (data && Array.isArray(data.pages)) {
        data.pages.forEach(function (page) {
          if (!page || !page.key || page.key.indexOf(STORE_PREFIX) !== 0 || !Array.isArray(page.highlights)) return;
          var existing = [];
          try {
            var raw = localStorage.getItem(page.key);
            if (raw) {
              var parsed = JSON.parse(raw);
              if (parsed && Array.isArray(parsed.highlights)) existing = parsed.highlights;
            }
          } catch (e) { /* 忽略 */ }
          var merged = mergeById(existing, page.highlights);
          imported += merged.length - existing.length;
          try {
            localStorage.setItem(page.key, JSON.stringify({
              v: 1,
              url: page.url || page.key.slice(STORE_PREFIX.length),
              highlights: merged
            }));
          } catch (e) { /* 忽略单页失败 */ }
          if (page.key === PAGE_KEY) {
            state.highlights = merged;
          }
        });
      } else if (data && Array.isArray(data.highlights)) {
        var before = state.highlights.length;
        state.highlights = mergeById(state.highlights, data.highlights);
        imported += state.highlights.length - before;
        save();
      } else {
        toast('导入失败：文件格式不正确');
        return;
      }

      renderAll();
      toast(imported > 0 ? '已导入 ' + imported + ' 条高亮' : '没有新的高亮可导入');
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* ============================================================
   * 事件绑定
   * ============================================================ */
  function bindEvents() {
    var selectionTimer = null;
    function scheduleCheck() {
      clearTimeout(selectionTimer);
      selectionTimer = setTimeout(checkSelection, 120);
    }

    document.addEventListener('mouseup', function (event) {
      if (event.target && event.target.closest && event.target.closest('#dm-hl-ui')) return;
      scheduleCheck();
    }, true);

    document.addEventListener('keyup', function (event) {
      if (event.key === 'Escape') {
        hideBar();
        hideMenu();
        closeEditor();
        closePanel();
        return;
      }
      if (event.shiftKey || event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
          event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'Home' || event.key === 'End') {
        scheduleCheck();
      }
    }, true);

    document.addEventListener('selectionchange', scheduleCheck, true);

    document.addEventListener('mousedown', function (event) {
      if (event.target && event.target.closest && event.target.closest('#dm-hl-ui')) return;
      hideBar();
      hideMenu();
    }, true);

    document.addEventListener('contextmenu', function (event) {
      if (event.target && event.target.closest && event.target.closest('#dm-hl-ui')) return;

      var mark = event.target.closest && event.target.closest('mark.dm-hl');
      if (mark) {
        event.preventDefault();
        openEditor('edit', mark.getAttribute('data-hl-id'));
        positionNear(ui.editor, mark.getBoundingClientRect());
        return;
      }

      var anchor = buildAnchor();
      if (!anchor) return;
      event.preventDefault();
      pending = anchor;
      showMenuAt(event.clientX, event.clientY);
    }, true);

    document.addEventListener('click', function (event) {
      if (event.target && event.target.closest && event.target.closest('#dm-hl-ui')) return;
      var mark = event.target.closest && event.target.closest('mark.dm-hl');
      if (!mark) return;
      event.preventDefault();
      event.stopPropagation();
      openEditor('edit', mark.getAttribute('data-hl-id'));
      positionNear(ui.editor, mark.getBoundingClientRect());
    }, true);

    window.addEventListener('scroll', function () { hideBar(); hideMenu(); }, { passive: true });
    window.addEventListener('resize', function () { hideBar(); hideMenu(); });

    window.addEventListener('storage', function (event) {
      if (event.key !== PAGE_KEY) return;
      load();
      renderAll();
    });
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function init() {
    load();
    ensureUI();
    bindEvents();
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
