/* ============================================================
 * 全站主题切换（浅色 / 深色）
 * - 在 <head> 中、Mermaid 初始化之前同步执行，避免首屏闪烁
 * - 记忆用户选择（localStorage），未选择时跟随系统偏好
 * - 切换时同步重新渲染页面中的所有 Mermaid 图表
 * ============================================================ */
(function () {
  'use strict';

  var STORAGE_KEY = 'dm-theme';
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var hasChoice = false;
  var current = 'light';
  var baseMermaidConfig = null;
  var mermaidNodes = [];
  var renderChain = Promise.resolve();

  /* ---------- 读取偏好 ---------- */
  try {
    var saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      current = saved;
      hasChoice = true;
    }
  } catch (e) { /* 隐私模式下忽略 */ }

  if (!hasChoice && media && media.matches) current = 'dark';

  /* ---------- 立即应用，避免闪烁 ---------- */
  function applyTheme(theme) {
    current = theme;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    root.style.colorScheme = theme;
  }
  applyTheme(current);

  /* ---------- Mermaid：按主题生成配置 ---------- */
  var DARK_MERMAID_VARS = {
    darkMode: true,
    background: '#171b21',
    primaryColor: '#242a33',
    primaryTextColor: '#dfe4ea',
    primaryBorderColor: '#4a5260',
    lineColor: '#8b94a0',
    secondaryColor: '#20262e',
    tertiaryColor: '#1c2128',
    mainBkg: '#242a33',
    nodeBorder: '#4a5260',
    clusterBkg: '#1d222a',
    clusterBorder: '#39414d',
    titleColor: '#dfe4ea',
    edgeLabelBackground: '#171b21',
    textColor: '#dfe4ea',
    actorBkg: '#242a33',
    actorBorder: '#4a5260',
    actorTextColor: '#dfe4ea',
    actorLineColor: '#5b6572',
    signalColor: '#c3cbd6',
    signalTextColor: '#dfe4ea',
    labelBoxBkgColor: '#242a33',
    labelBoxBorderColor: '#4a5260',
    labelTextColor: '#dfe4ea',
    loopTextColor: '#dfe4ea',
    noteBkgColor: '#332b18',
    noteTextColor: '#e8d9b5',
    noteBorderColor: '#6b5a30',
    sequenceNumberColor: '#171b21'
  };

  function darkMermaidConfig(cfg) {
    var src = cfg || {};
    var out = {};
    var k;
    for (k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    }
    var tv = {};
    var baseTv = src.themeVariables || {};
    for (k in baseTv) {
      if (Object.prototype.hasOwnProperty.call(baseTv, k)) tv[k] = baseTv[k];
    }
    if (!tv.fontSize) tv.fontSize = '14px';
    for (k in DARK_MERMAID_VARS) {
      if (Object.prototype.hasOwnProperty.call(DARK_MERMAID_VARS, k)) {
        tv[k] = DARK_MERMAID_VARS[k];
      }
    }
    out.theme = 'dark';
    out.themeVariables = tv;
    return out;
  }

  function patchMermaid() {
    var m = window.mermaid;
    if (!m || m.__dmThemed || typeof m.initialize !== 'function') return;
    var originalInitialize = m.initialize;
    m.initialize = function (cfg) {
      if (cfg && typeof cfg === 'object') baseMermaidConfig = cfg;
      var next = current === 'dark' ? darkMermaidConfig(cfg) : cfg;
      return originalInitialize.call(m, next);
    };
    m.__dmThemed = true;
  }
  patchMermaid();

  /* ---------- 记录图表源码，便于切换主题后重绘 ---------- */
  function captureMermaidSources() {
    mermaidNodes = Array.prototype.slice.call(document.querySelectorAll('.mermaid'));
    mermaidNodes.forEach(function (node) {
      if (typeof node.__dmSource !== 'string') node.__dmSource = node.innerHTML;
    });
  }

  function rerenderMermaid() {
    var m = window.mermaid;
    if (!m || !baseMermaidConfig || !mermaidNodes.length) return;

    try {
      m.initialize(baseMermaidConfig);
    } catch (e) { /* 忽略初始化异常 */ }

    var nodes = [];
    mermaidNodes.forEach(function (node) {
      if (!node.isConnected) return;
      if (typeof node.__dmSource !== 'string') return;
      node.removeAttribute('data-processed');
      node.innerHTML = node.__dmSource;
      nodes.push(node);
    });
    if (!nodes.length || typeof m.run !== 'function') return;

    renderChain = renderChain.then(function () {
      return m.run({ nodes: nodes, suppressErrors: true });
    }).catch(function (err) {
      if (window.console && console.warn) console.warn('[theme] Mermaid 重新渲染失败：', err);
    });
  }

  /* ---------- 按钮 ---------- */
  function buttonMarkup(theme) {
    var dark = theme === 'dark';
    return '<span class="dm-tt-icon" aria-hidden="true">' + (dark ? '☀️' : '🌙') + '</span>' +
      '<span class="dm-tt-label">' + (dark ? '日间' : '夜间') + '</span>';
  }

  function syncButtons() {
    var buttons = document.querySelectorAll('.dm-theme-toggle');
    Array.prototype.forEach.call(buttons, function (btn) {
      var dark = current === 'dark';
      btn.innerHTML = buttonMarkup(current);
      btn.setAttribute('aria-pressed', dark ? 'true' : 'false');
      btn.setAttribute('aria-label', dark ? '切换到浅色模式' : '切换到深色模式');
      btn.setAttribute('title', dark ? '切换到浅色模式' : '切换到深色模式');
    });
  }

  function updateMetaThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', current === 'dark' ? '#15171c' : '#f9f9f9');
  }

  function injectButton() {
    if (document.querySelector('.dm-theme-toggle')) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dm-theme-toggle';
    btn.innerHTML = buttonMarkup(current);

    var topbarRight = document.querySelector('.topbar-right');
    var topNav = document.querySelector('.top-nav');

    if (topbarRight) {
      topbarRight.appendChild(btn);
      btn.classList.add('dm-theme-toggle--compact');
    } else if (topNav) {
      topNav.appendChild(btn);
      btn.classList.add('dm-theme-toggle--nav');
    } else {
      document.body.appendChild(btn);
      btn.classList.add('dm-theme-toggle--floating');
    }

    btn.addEventListener('click', toggleTheme);
    syncButtons();
  }

  /* ---------- 切换 ---------- */
  function toggleTheme() {
    applyTheme(current === 'dark' ? 'light' : 'dark');
    hasChoice = true;
    try {
      localStorage.setItem(STORAGE_KEY, current);
    } catch (e) { /* 忽略 */ }
    syncButtons();
    updateMetaThemeColor();
    rerenderMermaid();
    try {
      document.dispatchEvent(new CustomEvent('dm-theme-change', { detail: { theme: current } }));
    } catch (e) { /* 忽略 */ }
  }

  /* ---------- 跟随系统（用户尚未手动选择时） ---------- */
  if (media) {
    var onSystemChange = function (event) {
      if (hasChoice) return;
      applyTheme(event.matches ? 'dark' : 'light');
      syncButtons();
      updateMetaThemeColor();
      rerenderMermaid();
    };
    if (media.addEventListener) media.addEventListener('change', onSystemChange);
    else if (media.addListener) media.addListener(onSystemChange);
  }

  /* ---------- 初始化 ---------- */
  function onReady() {
    patchMermaid();
    captureMermaidSources();
    injectButton();
    updateMetaThemeColor();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady);
  } else {
    onReady();
  }
})();
