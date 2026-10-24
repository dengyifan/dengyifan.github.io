/* ============================================================
 * 章节自测 / 练习历史（共享引擎）
 * ------------------------------------------------------------
 * 依赖：
 *   - style/shared.css  站点基础样式
 *   - style/exam.css    自测页样式
 *   - style/theme.css   深色主题
 *   - <chapter>_questions.js  题库（window.DM_EXAM_BANKS）
 *
 * 数据：
 *   - 练习历史：localStorage  dm-exam:v1:history
 *   - 练习草稿：localStorage  dm-exam:v1:draft:<examId>
 *
 * 功能：
 *   - 按小节随机抽题、即时判分与解析、答题卡、交卷
 *   - 结果统计、错题复习、全部作答回看、错题重做
 *   - 全站练习历史、错题快照、删除 / 清空
 *   - 历史记录导出 / 导入（按记录 id 合并，手工跨设备同步）
 * ============================================================ */
(function () {
  'use strict';

  var STORE_HISTORY = 'dm-exam:v1:history';
  var STORE_DRAFT = 'dm-exam:v1:draft:';
  var MAX_RECORDS = 80;

  var app = null;
  var exam = null;
  var examId = '';
  var bankMap = {};
  var history = [];
  var session = null;
  var view = 'home';
  var timerId = null;
  var review = null;
  var toastTimer = null;

  var LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

  /* 各章自测页在站点中的位置；用于跨章节历史记录跳转 */
  var EXAM_FILES = {
    ch1: 'sys_arch_designer/01-introduction/chapter1_exam.html',
    ch2: 'sys_arch_designer/02-chapter2/chapter2_exam.html'
  };

  function examHref(record) {
    var target = EXAM_FILES[record.examId];
    if (!target) {
      var fallback = record.examPath || '';
      return /^(?:\.{0,2}\/|\/)?[A-Za-z0-9_\-./]+$/.test(fallback) ? fallback : '';
    }
    var marker = '/sys_arch_designer/';
    var here = window.location.pathname;
    var at = here.indexOf(marker);
    if (at === -1) return '';
    return here.slice(0, at + marker.length) + target.slice('sys_arch_designer/'.length);
  }

  /* ============================================================
   * 基础工具
   * ============================================================ */
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function closest(el, selector) {
    while (el && el !== document) {
      if (el.nodeType === 1 && el.matches(selector)) return el;
      el = el.parentNode;
    }
    return null;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
    return list;
  }

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function fmtDate(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    if (sec < 60) return sec + ' 秒';
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    if (m < 60) return m + ' 分' + (s ? s + ' 秒' : '');
    var h = Math.floor(m / 60);
    return h + ' 小时' + (m % 60) + ' 分';
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return (h ? pad2(h) + ':' : '') + pad2(m) + ':' + pad2(s);
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function sectionTitle(id) {
    for (var i = 0; i < exam.sections.length; i++) {
      if (exam.sections[i].id === id) return exam.sections[i].title;
    }
    return id || '综合';
  }

  function questionMap() {
    var map = {};
    for (var i = 0; i < exam.questions.length; i++) {
      map[exam.questions[i].id] = exam.questions[i];
    }
    return map;
  }

  function resolveQuestions(ids) {
    var map = questionMap();
    var out = [];
    (ids || []).forEach(function (id) {
      if (map[id]) out.push(map[id]);
    });
    return out;
  }

  function recordById(id) {
    for (var i = 0; i < history.length; i++) {
      if (history[i].id === id) return history[i];
    }
    return null;
  }

  function currentQuestions() {
    return session ? resolveQuestions(session.ids) : [];
  }

  function isAnswered(q) {
    return session && has(session.answers, q.id) && session.answers[q.id] != null;
  }

  /* ============================================================
   * 存储：历史 / 草稿
   * ============================================================ */
  function readHistory() {
    try {
      var raw = localStorage.getItem(STORE_HISTORY);
      if (!raw) return [];
      var data = JSON.parse(raw);
      var records = Array.isArray(data) ? data : (data && data.records);
      if (!Array.isArray(records)) return [];
      return records
        .map(normalizeRecord)
        .filter(Boolean)
        .sort(function (a, b) { return b.finishedAt - a.finishedAt; })
        .slice(0, MAX_RECORDS);
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(STORE_HISTORY, JSON.stringify({
        v: 1,
        updatedAt: Date.now(),
        records: list
      }));
      return true;
    } catch (e) {
      toast('本地存储写入失败，请清理浏览器空间或导出备份');
      return false;
    }
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || !raw.id) return null;
    if (typeof raw.examId !== 'string' || !raw.examId) return null;
    if (typeof raw.finishedAt !== 'number' || !isFinite(raw.finishedAt)) return null;
    var total = Number(raw.total);
    if (!isFinite(total) || total <= 0) return null;
    var answers = raw.answers && typeof raw.answers === 'object' ? raw.answers : {};
    var wrongItems = Array.isArray(raw.wrongItems) ? raw.wrongItems.filter(function (it) {
      return it && typeof it.stem === 'string' && Array.isArray(it.options);
    }) : [];
    var sections = Array.isArray(raw.sections) ? raw.sections.filter(function (s) {
      return s && typeof s.title === 'string';
    }) : [];
    return {
      v: 1,
      id: raw.id,
      examId: raw.examId,
      examTitle: typeof raw.examTitle === 'string' ? raw.examTitle : raw.examId,
      examPath: typeof raw.examPath === 'string' ? raw.examPath : '',
      startedAt: Number(raw.startedAt) || (raw.finishedAt - (Number(raw.durationSec) || 0) * 1000),
      finishedAt: raw.finishedAt,
      durationSec: Math.max(0, Number(raw.durationSec) || 0),
      total: total,
      correct: Math.max(0, Number(raw.correct) || 0),
      wrong: Math.max(0, Number(raw.wrong) || 0),
      unanswered: Math.max(0, Number(raw.unanswered) || 0),
      score: Math.max(0, Math.min(100, Math.round(Number(raw.score) || 0))),
      sections: sections.map(function (s) {
        return {
          id: typeof s.id === 'string' ? s.id : '',
          title: s.title,
          total: Math.max(0, Number(s.total) || 0),
          correct: Math.max(0, Number(s.correct) || 0)
        };
      }),
      answers: answers,
      questionIds: Array.isArray(raw.questionIds) ? raw.questionIds : [],
      wrongItems: wrongItems.map(function (it) {
        return {
          id: typeof it.id === 'string' ? it.id : '',
          section: typeof it.section === 'string' ? it.section : '',
          sectionTitle: typeof it.sectionTitle === 'string' ? it.sectionTitle : '',
          stem: it.stem,
          options: it.options,
          answer: Number(it.answer) || 0,
          analysis: typeof it.analysis === 'string' ? it.analysis : '',
          chosen: typeof it.chosen === 'number' ? it.chosen : null
        };
      })
    };
  }

  function draftKey() {
    return STORE_DRAFT + examId;
  }

  function readDraft() {
    try {
      var raw = localStorage.getItem(draftKey());
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.examId !== examId || !Array.isArray(d.ids) || !d.ids.length) return null;
      var valid = resolveQuestions(d.ids);
      if (!valid.length) return null;
      var answers = d.answers && typeof d.answers === 'object' ? d.answers : {};
      return {
        ids: valid.map(function (q) { return q.id; }),
        answers: answers,
        index: Math.max(0, Math.min(valid.length - 1, Number(d.index) || 0)),
        elapsed: Math.max(0, Number(d.elapsed) || 0),
        startedAt: Number(d.startedAt) || Date.now()
      };
    } catch (e) {
      return null;
    }
  }

  function saveDraft() {
    if (!session || session.finished) return;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        v: 1,
        examId: examId,
        ids: session.ids,
        answers: session.answers,
        index: session.index,
        elapsed: elapsedSeconds(),
        startedAt: session.startedAt
      }));
    } catch (e) { /* 草稿写入失败不阻塞答题 */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (e) { /* 忽略 */ }
  }

  /* ============================================================
   * 计时
   * ============================================================ */
  function elapsedSeconds() {
    if (!session) return 0;
    if (session.finished) return session.durationSec || 0;
    return Math.max(0, Math.round(session.elapsedBase + (Date.now() - session.startedAt) / 1000));
  }

  function tickTimer() {
    var el = $('#examTimer');
    if (el && session && !session.finished) {
      el.textContent = '⏱ ' + fmtClock(elapsedSeconds());
    }
  }

  function startTimer() {
    stopTimer();
    tickTimer();
    timerId = setInterval(tickTimer, 1000);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  /* ============================================================
   * 轻提示 / 弹层
   * ============================================================ */
  function toast(message) {
    var el = $('#examToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'examToast';
      el.className = 'exam-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add('is-show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove('is-show');
    }, 2400);
  }

  function closeModal() {
    var modal = $('.exam-modal');
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  function showModal(options) {
    closeModal();
    var wrap = document.createElement('div');
    wrap.className = 'exam-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML =
      '<div class="exam-modal-box">' +
        '<h3 class="exam-modal-title">' + esc(options.title || '请确认') + '</h3>' +
        '<p class="exam-modal-body">' + esc(options.body || '') + '</p>' +
        '<div class="exam-modal-actions">' +
          '<button type="button" class="exam-btn" data-modal="cancel">' + esc(options.cancelText || '取消') + '</button>' +
          '<button type="button" class="exam-btn ' + (options.danger ? 'exam-btn--danger' : 'exam-btn--primary') + '" data-modal="confirm">' +
            esc(options.confirmText || '确定') +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    function done(ok) {
      closeModal();
      if (ok && typeof options.onConfirm === 'function') options.onConfirm();
    }

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) { done(false); return; }
      var btn = closest(e.target, '[data-modal]');
      if (!btn) return;
      done(btn.getAttribute('data-modal') === 'confirm');
    });

    var confirmBtn = $('[data-modal="confirm"]', wrap);
    if (confirmBtn) confirmBtn.focus();

    wrap.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') done(false);
    });
  }

  /* ============================================================
   * 练习会话
   * ============================================================ */
  function buildOrder() {
    var groups = {};
    exam.questions.forEach(function (q) {
      if (!groups[q.section]) groups[q.section] = [];
      groups[q.section].push(q);
    });
    var result = [];
    exam.sections.forEach(function (s) {
      var arr = groups[s.id];
      if (arr && arr.length) result = result.concat(shuffle(arr.slice()));
    });
    Object.keys(groups).forEach(function (key) {
      if (!exam.sections.some(function (s) { return s.id === key; })) {
        result = result.concat(shuffle(groups[key].slice()));
      }
    });
    return result;
  }

  function startSession(ids) {
    var questions = ids && ids.length ? resolveQuestions(ids) : null;
    if (!questions || !questions.length) {
      questions = buildOrder();
      ids = questions.map(function (q) { return q.id; });
    }
    if (!questions.length) {
      toast('题库为空，无法开始练习');
      return;
    }
    session = {
      ids: questions.map(function (q) { return q.id; }),
      answers: {},
      index: 0,
      startedAt: Date.now(),
      elapsedBase: 0,
      finished: false,
      record: null
    };
    view = 'quiz';
    saveDraft();
    renderQuiz();
    startTimer();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function resumeDraft() {
    var d = readDraft();
    if (!d) {
      toast('没有可恢复的练习');
      renderHome();
      return;
    }
    session = {
      ids: d.ids,
      answers: d.answers,
      index: d.index,
      startedAt: Date.now(),
      elapsedBase: d.elapsed,
      finished: false,
      record: null
    };
    view = 'quiz';
    renderQuiz();
    startTimer();
  }

  function finishSession(force) {
    if (!session || session.finished) return;
    var questions = currentQuestions();
    var unanswered = questions.filter(function (q) { return !isAnswered(q); }).length;
    if (!force && unanswered > 0) {
      showModal({
        title: '还有 ' + unanswered + ' 题未作答',
        body: '现在交卷将按已作答情况计分，未作答题目记为错误。确定要交卷吗？',
        confirmText: '确定交卷',
        cancelText: '继续作答',
        onConfirm: function () { finishSession(true); }
      });
      return;
    }

    var duration = elapsedSeconds();
    session.durationSec = duration;
    session.finished = true;
    stopTimer();
    var record = buildRecord(duration);
    session.record = record;

    history.unshift(record);
    if (history.length > MAX_RECORDS) history = history.slice(0, MAX_RECORDS);
    saveHistory(history);
    clearDraft();

    view = 'result';
    renderResult();
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function buildRecord(duration) {
    var questions = currentQuestions();
    var sectionStats = {};
    exam.sections.forEach(function (s) {
      sectionStats[s.id] = { id: s.id, title: s.title, total: 0, correct: 0 };
    });
    var correct = 0;
    var wrong = 0;
    var unanswered = 0;
    var wrongItems = [];

    questions.forEach(function (q) {
      var stat = sectionStats[q.section] || (sectionStats[q.section] = {
        id: q.section,
        title: sectionTitle(q.section),
        total: 0,
        correct: 0
      });
      stat.total += 1;
      if (!isAnswered(q)) {
        unanswered += 1;
        return;
      }
      var chosen = Number(session.answers[q.id]);
      if (chosen === q.answer) {
        correct += 1;
        stat.correct += 1;
      } else {
        wrong += 1;
        wrongItems.push({
          id: q.id,
          section: q.section,
          sectionTitle: sectionTitle(q.section),
          stem: q.stem,
          options: q.options,
          answer: q.answer,
          analysis: q.analysis,
          chosen: chosen
        });
      }
    });

    var total = questions.length;
    return {
      v: 1,
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      examId: examId,
      examTitle: exam.title,
      examPath: exam.path || (examId + '_exam.html'),
      startedAt: session.startedAt - (session.elapsedBase || 0) * 1000,
      finishedAt: Date.now(),
      durationSec: Math.round(duration),
      total: total,
      correct: correct,
      wrong: wrong,
      unanswered: unanswered,
      score: total ? Math.round(correct / total * 100) : 0,
      sections: exam.sections.map(function (s) { return sectionStats[s.id]; }).filter(function (s) { return s.total > 0; }),
      answers: JSON.parse(JSON.stringify(session.answers)),
      questionIds: session.ids.slice(),
      wrongItems: wrongItems
    };
  }

  /* ============================================================
   * 公共片段
   * ============================================================ */
  function sectionCounts() {
    var counts = {};
    exam.questions.forEach(function (q) {
      counts[q.section] = (counts[q.section] || 0) + 1;
    });
    return counts;
  }

  function recordRow(r, withDelete) {
    return '<div class="exam-record">' +
      '<div class="exam-record-main">' +
        '<div class="exam-record-title">' + esc(r.examTitle) +
          '<span class="exam-record-tag">' + (r.examId === examId ? '本章' : '其他章节') + '</span>' +
        '</div>' +
        '<div class="exam-record-meta">' +
          '<span>' + fmtDate(r.finishedAt) + '</span>' +
          '<span>用时 ' + fmtDuration(r.durationSec) + '</span>' +
          '<span>正确 ' + r.correct + '</span>' +
          '<span>错误 ' +
            (r.wrong > 0
              ? '<button type="button" class="exam-wrong-link" data-act="history-wrong" data-id="' + esc(r.id) + '" title="逐题查看错题">' + r.wrong + '</button>'
              : '0') +
          '</span>' +
          '<span>未答 ' + r.unanswered + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="exam-record-side">' +
        '<div class="exam-score">' + r.score + '<small>分</small></div>' +
        '<button type="button" class="exam-btn exam-btn--sm" data-act="history-detail" data-id="' + esc(r.id) + '">查看详情</button>' +
        (withDelete ? '<button type="button" class="exam-btn exam-btn--sm exam-btn--danger" data-act="history-delete" data-id="' + esc(r.id) + '">删除</button>' : '') +
      '</div>' +
    '</div>';
  }

  function reviewItem(item, index) {
    var answered = item.chosen != null;
    var correct = answered && item.chosen === item.answer;
    var optionsHtml = item.options.map(function (text, i) {
      var cls = '';
      if (i === item.answer) cls = ' is-correct';
      else if (i === item.chosen) cls = ' is-wrong';
      var mark = i === item.answer ? '✓ ' : (i === item.chosen ? '✕ ' : '');
      return '<div class="exam-review-option' + cls + '"><span class="letter">' + LETTERS[i] + '</span>' +
        '<span>' + mark + esc(text) + '</span></div>';
    }).join('');
    var chosenText = answered ? LETTERS[item.chosen] : '未作答';
    var resultText = correct
      ? '回答正确'
      : (answered
        ? '回答错误 · 你的答案 ' + chosenText + ' · 正确答案 ' + LETTERS[item.answer]
        : '未作答 · 正确答案 ' + LETTERS[item.answer]);
    return '<article class="exam-review-item ' + (correct ? 'is-correct' : (answered ? '' : 'is-unanswered')) + '">' +
      '<div class="exam-review-head">' +
        '<span>第 ' + (index + 1) + ' 题</span>' +
        '<span class="tag">' + esc(item.sectionTitle || sectionTitle(item.section)) + '</span>' +
        '<span class="result ' + (correct ? 'is-correct' : (answered ? 'is-wrong' : '')) + '">' +
          resultText +
        '</span>' +
      '</div>' +
      '<h3 class="exam-review-stem">' + esc(item.stem) + '</h3>' +
      '<div class="exam-review-options">' + optionsHtml + '</div>' +
      (item.analysis ? '<div class="exam-review-analysis"><b>解析：</b>' + esc(item.analysis) + '</div>' : '') +
    '</article>';
  }

  function sectionBars(sections) {
    if (!sections || !sections.length) return '';
    return '<div class="exam-section-bars">' + sections.map(function (s) {
      var pct = s.total ? Math.round(s.correct / s.total * 100) : 0;
      return '<div class="exam-section-bar">' +
        '<div class="exam-section-bar-head"><b>' + esc(s.title) + '</b><span>' + s.correct + ' / ' + s.total + ' · ' + pct + '%</span></div>' +
        '<div class="exam-section-bar-track"><div class="exam-section-bar-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ============================================================
   * 首页
   * ============================================================ */
  function renderHome() {
    stopTimer();
    view = 'home';
    var counts = sectionCounts();
    var draft = readDraft();
    var answered = 0;
    if (draft) {
      draft.ids.forEach(function (id) {
        if (has(draft.answers, id) && draft.answers[id] != null) answered += 1;
      });
    }
    var recent = history.slice(0, 3);
    var coverage = exam.sections.map(function (s) {
      return '<li><b>' + esc(s.id + ' ' + s.title) + '</b><span>' + (counts[s.id] || 0) + ' 题</span></li>';
    }).join('');

    app.innerHTML =
      '<section class="exam-hero">' +
        '<div>' +
          '<span class="exam-eyebrow">章节自测 · 软考模拟</span>' +
          '<h1>' + esc(exam.title) + '</h1>' +
          '<p class="exam-hero-desc">' + esc(exam.description || '') + '</p>' +
          '<div class="exam-stats">' +
            '<div class="exam-stat"><strong>' + exam.questions.length + '</strong><span>题目总数</span></div>' +
            '<div class="exam-stat"><strong>' + exam.sections.length + '</strong><span>知识模块</span></div>' +
            '<div class="exam-stat"><strong>' + (exam.suggestedMinutes || Math.round(exam.questions.length)) + '</strong><span>建议用时（分钟）</span></div>' +
          '</div>' +
          '<div class="exam-actions">' +
            '<button type="button" class="exam-btn exam-btn--primary" data-act="start">开始练习</button>' +
            (draft ? '<button type="button" class="exam-btn" data-act="resume">继续上次（已答 ' + answered + ' / ' + draft.ids.length + '）</button>' : '') +
            '<button type="button" class="exam-btn exam-btn--ghost" data-act="history">练习历史（' + history.length + '）</button>' +
          '</div>' +
        '</div>' +
        '<aside class="exam-side-card">' +
          '<h2>本章覆盖</h2>' +
          '<ul class="exam-cover-list">' + coverage + '</ul>' +
        '</aside>' +
      '</section>' +

      '<section class="exam-panel">' +
        '<div class="exam-panel-head"><h2>练习说明</h2><span class="exam-panel-sub">按小节随机出题 · 即时解析</span></div>' +
        '<ul class="exam-tips">' +
          '<li><b>覆盖整章：</b>题目按知识模块均衡抽取，每次练习都会覆盖全部小节。</li>' +
          '<li><b>即时判分：</b>选择答案后立即显示对错与解析，答错也能当场弄懂。</li>' +
          '<li><b>历史复盘：</b>每次交卷都会保存成绩与错题，可逐题查看错题解析。</li>' +
          '<li><b>手工同步：</b>历史记录保存在本机浏览器，可在历史页导出 JSON，在另一台设备导入。</li>' +
        '</ul>' +
      '</section>' +

      '<section class="exam-panel">' +
        '<div class="exam-panel-head">' +
          '<h2>最近练习</h2>' +
          '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost" data-act="history">查看全部历史 →</button>' +
        '</div>' +
        (recent.length
          ? '<div class="exam-record-list">' + recent.map(function (r) { return recordRow(r, false); }).join('') + '</div>'
          : '<div class="exam-empty"><span class="exam-empty-icon">🗂</span>还没有练习记录，完成一次自测后会在这里留下成绩与错题。</div>') +
      '</section>';
  }

  /* ============================================================
   * 练习页
   * ============================================================ */
  function renderQuiz() {
    if (!session) { renderHome(); return; }
    view = 'quiz';
    var questions = currentQuestions();
    if (!questions.length) { renderHome(); return; }
    if (session.index >= questions.length) session.index = questions.length - 1;
    if (session.index < 0) session.index = 0;

    var q = questions[session.index];
    var answered = isAnswered(q);
    var chosen = answered ? Number(session.answers[q.id]) : null;
    var isCorrect = answered && chosen === q.answer;
    var total = questions.length;
    var answeredCount = questions.filter(isAnswered).length;
    var pct = Math.round(answeredCount / total * 100);

    var optionsHtml = q.options.map(function (text, i) {
      var cls = 'exam-option';
      if (answered) {
        if (i === q.answer) cls += ' is-correct';
        else if (i === chosen) cls += ' is-wrong';
      } else if (i === chosen) {
        cls += ' is-chosen';
      }
      return '<button type="button" class="' + cls + '" data-act="pick" data-index="' + i + '"' +
        (answered ? ' disabled' : '') + '>' +
        '<span class="exam-option-letter">' + LETTERS[i] + '</span>' +
        '<span>' + esc(text) + '</span>' +
      '</button>';
    }).join('');

    var feedback = '';
    if (answered) {
      feedback = '<div class="exam-feedback ' + (isCorrect ? '' : 'is-wrong') + '" role="status">' +
        '<div class="exam-feedback-title ' + (isCorrect ? 'is-correct' : 'is-wrong') + '">' +
          (isCorrect ? '回答正确' : '回答错误') +
        '</div>' +
        '<div class="exam-feedback-answer">正确答案：' + LETTERS[q.answer] + (isCorrect ? '' : ' · 你的答案：' + LETTERS[chosen]) + '</div>' +
        (q.analysis ? '<div class="exam-feedback-analysis">' + esc(q.analysis) + '</div>' : '') +
      '</div>';
    }

    var sheet = questions.map(function (item, i) {
      var cls = 'exam-sheet-cell';
      var state = '未答';
      if (isAnswered(item)) {
        if (Number(session.answers[item.id]) === item.answer) {
          cls += ' is-correct';
          state = '答对';
        } else {
          cls += ' is-wrong';
          state = '答错';
        }
      }
      if (i === session.index) cls += ' is-current';
      return '<button type="button" class="' + cls + '" data-act="jump" data-index="' + i + '" ' +
        'aria-label="第 ' + (i + 1) + ' 题，' + state + '">' + (i + 1) + '</button>';
    }).join('');

    app.innerHTML =
      '<div class="exam-bar">' +
        '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost" data-act="home">← 返回</button>' +
        '<div class="exam-bar-title">' + esc(exam.title) + '<span>第 ' + (session.index + 1) + ' / ' + total + ' 题</span></div>' +
        '<div class="exam-timer" id="examTimer">⏱ ' + fmtClock(elapsedSeconds()) + '</div>' +
        '<button type="button" class="exam-btn exam-btn--sm" data-act="sheet-toggle">答题卡</button>' +
      '</div>' +
      '<div class="exam-progress" aria-hidden="true"><div class="exam-progress-fill" style="width:' + pct + '%"></div></div>' +

      '<div class="exam-layout">' +
        '<main class="exam-q-card">' +
          '<div class="exam-q-meta">' +
            '<span class="exam-q-badge">' + (session.index + 1) + '</span>' +
            '<span class="exam-q-section">' + esc(q.section + ' ' + sectionTitle(q.section)) + '</span>' +
            '<span class="exam-q-status ' + (answered ? (isCorrect ? 'is-correct' : 'is-wrong') : '') + '">' +
              (answered ? (isCorrect ? '已答对' : '已答错') : '未作答') +
            '</span>' +
          '</div>' +
          '<h2 class="exam-q-stem">' + esc(q.stem) + '</h2>' +
          '<div class="exam-options">' + optionsHtml + '</div>' +
          feedback +
          '<div class="exam-q-nav">' +
            '<button type="button" class="exam-btn" data-act="prev"' + (session.index === 0 ? ' disabled' : '') + '>上一题</button>' +
            '<span class="exam-q-index">已答 ' + answeredCount + ' / ' + total + '</span>' +
            '<button type="button" class="exam-btn" data-act="next"' + (session.index === total - 1 ? ' disabled' : '') + '>下一题</button>' +
            '<button type="button" class="exam-btn exam-btn--primary" data-act="submit">交卷</button>' +
          '</div>' +
        '</main>' +

        '<aside class="exam-sheet" id="examSheet">' +
          '<div class="exam-panel-head" style="margin-bottom:6px">' +
            '<h3>答题卡</h3>' +
            '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost exam-sheet-close" data-act="sheet-close">关闭</button>' +
          '</div>' +
          '<div class="exam-sheet-sub">已答 ' + answeredCount + ' / ' + total + ' · 点击题号跳转</div>' +
          '<div class="exam-sheet-grid">' + sheet + '</div>' +
          '<div class="exam-sheet-legend">' +
            '<span><i class="lg-answered"></i>已答</span>' +
            '<span><i class="lg-correct"></i>答对</span>' +
            '<span><i class="lg-wrong"></i>答错</span>' +
            '<span><i></i>未答</span>' +
          '</div>' +
          '<div class="exam-sheet-actions">' +
            '<button type="button" class="exam-btn exam-btn--primary" data-act="submit">交卷并查看成绩</button>' +
            '<button type="button" class="exam-btn exam-btn--ghost" data-act="home">保存进度并返回</button>' +
          '</div>' +
        '</aside>' +
      '</div>' +
      '<div class="exam-sheet-backdrop" id="examSheetBackdrop" data-act="sheet-close"></div>';
  }

  function pickOption(index) {
    if (!session || session.finished) return;
    var questions = currentQuestions();
    var q = questions[session.index];
    if (!q || isAnswered(q)) return;
    if (index < 0 || index >= q.options.length) return;
    session.answers[q.id] = index;
    saveDraft();
    renderQuiz();
  }

  function goTo(index) {
    if (!session) return;
    var total = session.ids.length;
    session.index = Math.max(0, Math.min(total - 1, index));
    saveDraft();
    closeSheet();
    renderQuiz();
  }

  function toggleSheet() {
    var sheet = $('#examSheet');
    var backdrop = $('#examSheetBackdrop');
    if (!sheet) return;
    sheet.classList.toggle('is-open');
    if (backdrop) backdrop.classList.toggle('is-open');
  }

  function closeSheet() {
    var sheet = $('#examSheet');
    var backdrop = $('#examSheetBackdrop');
    if (sheet) sheet.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
  }

  /* ============================================================
   * 结果页
   * ============================================================ */
  function renderResult() {
    stopTimer();
    view = 'result';
    var record = session && session.record;
    if (!record) { renderHome(); return; }
    var title = record.score >= 85 ? '掌握得很扎实' :
      record.score >= 70 ? '基础不错，继续补漏' :
      record.score >= 60 ? '刚刚及格，建议复习错题' : '需要系统复习本章';
    var desc = record.score >= 85 ? '本章主要考点已经掌握，可以进入下一章或做一次错题重做巩固。' :
      record.score >= 70 ? '大部分知识点已经掌握，重点看错题解析，把薄弱小节补齐。' :
      record.score >= 60 ? '达到及格线，但错题集中在部分小节，建议回到章节页重点复习。' :
      '错题较多，建议先重读本章对应小节，再回来做一次错题重做。';

    app.innerHTML =
      '<section class="exam-result-hero">' +
        '<div class="exam-score-ring" style="--score:' + record.score + '">' +
          '<div class="exam-score-ring-inner"><strong>' + record.score + '</strong><span>得分</span></div>' +
        '</div>' +
        '<div>' +
          '<h1 class="exam-result-title">' + title + '</h1>' +
          '<p class="exam-result-desc">' + desc + '</p>' +
          '<div class="exam-result-stats">' +
            '<div><b>' + record.correct + '</b> <span>答对</span></div>' +
            '<div><b>' + record.wrong + '</b> <span>答错</span></div>' +
            '<div><b>' + record.unanswered + '</b> <span>未答</span></div>' +
            '<div><b>' + fmtDuration(record.durationSec) + '</b> <span>用时</span></div>' +
          '</div>' +
        '</div>' +
      '</section>' +

      '<section class="exam-panel">' +
        '<div class="exam-panel-head"><h2>成绩概览</h2><span class="exam-panel-sub">' + esc(exam.title) + ' · ' + fmtDate(record.finishedAt) + '</span></div>' +
        '<div class="exam-result-actions" style="margin:0 0 18px">' +
          (record.wrong > 0 ? '<button type="button" class="exam-btn exam-btn--primary" data-act="review-wrong">查看错题（' + record.wrong + '）</button>' : '') +
          '<button type="button" class="exam-btn" data-act="review-all">查看全部作答</button>' +
          (record.wrong > 0 ? '<button type="button" class="exam-btn" data-act="retry-wrong">错题重做</button>' : '') +
          '<button type="button" class="exam-btn" data-act="start">再练一次</button>' +
          '<button type="button" class="exam-btn exam-btn--ghost" data-act="history">历史记录</button>' +
          '<button type="button" class="exam-btn exam-btn--ghost" data-act="home">返回首页</button>' +
        '</div>' +
        sectionBars(record.sections) +
      '</section>' +

      '<section class="exam-panel">' +
        '<div class="exam-panel-head"><h2>本次记录已保存</h2><span class="exam-panel-sub">可在“练习历史”导出或删除</span></div>' +
        '<p class="exam-panel-sub" style="line-height:1.8">记录保存在当前浏览器的 localStorage 中，不会自动上传。换设备时，请在历史页导出 JSON 文件，再到另一台设备导入。</p>' +
      '</section>';
  }

  /* ============================================================
   * 错题 / 全部作答
   * ============================================================ */
  function itemsFromSession(onlyWrong) {
    var questions = currentQuestions();
    var items = [];
    questions.forEach(function (q) {
      var answered = isAnswered(q);
      var chosen = answered ? Number(session.answers[q.id]) : null;
      if (onlyWrong && (!answered || chosen === q.answer)) return;
      items.push({
        id: q.id,
        section: q.section,
        sectionTitle: sectionTitle(q.section),
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        chosen: chosen
      });
    });
    return items;
  }

  /* 用当前题库还原某条历史记录的作答情况（仅同章节可用） */
  function itemsFromRecord(record, onlyWrong) {
    var map = questionMap();
    var items = [];
    (record.questionIds || []).forEach(function (id) {
      var q = map[id];
      if (!q) return;
      var answered = has(record.answers, id) && record.answers[id] != null;
      var chosen = answered ? Number(record.answers[id]) : null;
      if (onlyWrong && (!answered || chosen === q.answer)) return;
      items.push({
        id: q.id,
        section: q.section,
        sectionTitle: sectionTitle(q.section),
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        chosen: chosen
      });
    });
    return items;
  }

  function renderReview(items, onlyWrong, backAction, backLabel, backId) {
    view = 'review';
    review = { items: items, onlyWrong: onlyWrong, backAction: backAction };
    var wrongCount = items.filter(function (it) { return it.chosen != null && it.chosen !== it.answer; }).length;
    app.innerHTML =
      '<div class="exam-bar">' +
        '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost" data-act="' + backAction + '"' +
          (backId ? ' data-id="' + esc(backId) + '"' : '') + '>← ' + esc(backLabel) + '</button>' +
        '<div class="exam-bar-title">' + (onlyWrong ? '错题复习' : '全部作答') + '<span>' + items.length + ' 题 · 错 ' + wrongCount + ' 题</span></div>' +
      '</div>' +
      (items.length
        ? '<div class="exam-review-list">' + items.map(reviewItem).join('') + '</div>'
        : '<div class="exam-panel"><div class="exam-empty"><span class="exam-empty-icon">✓</span>本次练习没有错题，继续保持。</div></div>');
  }

  /* ============================================================
   * 历史
   * ============================================================ */
  function renderHistory() {
    stopTimer();
    view = 'history';
    var totalWrong = history.reduce(function (sum, r) { return sum + r.wrong; }, 0);
    var avg = history.length
      ? Math.round(history.reduce(function (sum, r) { return sum + r.score; }, 0) / history.length)
      : 0;

    app.innerHTML =
      '<section class="exam-panel">' +
        '<div class="exam-panel-head">' +
          '<div>' +
            '<h2>练习历史</h2>' +
            '<div class="exam-panel-sub" style="margin-top:4px">共 ' + history.length + ' 次 · 平均 ' + avg + ' 分 · 累计错题 ' + totalWrong + ' 道</div>' +
          '</div>' +
          '<div class="exam-actions">' +
            '<button type="button" class="exam-btn exam-btn--sm" data-act="history-export">导出全部</button>' +
            '<button type="button" class="exam-btn exam-btn--sm" data-act="history-import">导入</button>' +
            (history.length ? '<button type="button" class="exam-btn exam-btn--sm exam-btn--danger" data-act="history-clear">清空</button>' : '') +
            '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost" data-act="home">返回首页</button>' +
          '</div>' +
        '</div>' +
        '<p class="exam-panel-sub" style="line-height:1.8;margin-bottom:16px">' +
          '导出文件包含本站所有章节的练习记录。导入时按记录 ID 合并，同一记录保留完成时间较新的版本。' +
        '</p>' +
        (history.length
          ? '<div class="exam-record-list">' + history.map(function (r) { return recordRow(r, true); }).join('') + '</div>'
          : '<div class="exam-empty"><span class="exam-empty-icon">🗂</span>暂无练习历史。完成一次自测后，这里会显示成绩、用时和错题入口。</div>') +
      '</section>';
  }

  function renderHistoryDetail(id) {
    stopTimer();
    view = 'history-detail';
    var record = recordById(id);
    if (!record) { renderHistory(); return; }
    var isCurrent = record.examId === examId;
    var otherHref = isCurrent ? '' : examHref(record);
    var redoIds = record.wrongItems.map(function (it) { return it.id; });

    app.innerHTML =
      '<div class="exam-bar">' +
        '<button type="button" class="exam-btn exam-btn--sm exam-btn--ghost" data-act="history">← 返回历史</button>' +
        '<div class="exam-bar-title">' + esc(record.examTitle) + '<span>' + fmtDate(record.finishedAt) + '</span></div>' +
      '</div>' +

      '<section class="exam-result-hero">' +
        '<div class="exam-score-ring" style="--score:' + record.score + '">' +
          '<div class="exam-score-ring-inner"><strong>' + record.score + '</strong><span>得分</span></div>' +
        '</div>' +
        '<div>' +
          '<h1 class="exam-result-title">' + (record.wrong > 0 ? '本次练习有 ' + record.wrong + ' 道错题' : '本次练习全部答对') + '</h1>' +
          '<p class="exam-result-desc">用时 ' + fmtDuration(record.durationSec) + ' · 答对 ' + record.correct + ' / ' + record.total + ' 题' +
            (record.unanswered ? ' · 未答 ' + record.unanswered + ' 题' : '') + '</p>' +
          '<div class="exam-result-actions" style="margin:0">' +
            (record.wrongItems.length ? '<button type="button" class="exam-btn exam-btn--primary" data-act="history-wrong" data-id="' + esc(record.id) + '">逐题查看错题</button>' : '') +
            (isCurrent && record.questionIds.length ? '<button type="button" class="exam-btn" data-act="history-all" data-id="' + esc(record.id) + '">查看全部作答</button>' : '') +
            (isCurrent && redoIds.length ? '<button type="button" class="exam-btn" data-act="history-redo" data-id="' + esc(record.id) + '">错题重做</button>' : '') +
            (!isCurrent && otherHref ? '<a class="exam-btn" href="' + esc(otherHref) + '">前往该章自测</a>' : '') +
            '<button type="button" class="exam-btn exam-btn--danger" data-act="history-delete" data-id="' + esc(record.id) + '">删除记录</button>' +
          '</div>' +
        '</div>' +
      '</section>' +

      (record.sections.length
        ? '<section class="exam-panel"><div class="exam-panel-head"><h2>分模块正确率</h2></div>' + sectionBars(record.sections) + '</section>'
        : '') +

      '<section class="exam-panel">' +
        '<div class="exam-panel-head"><h2>错题详情</h2><span class="exam-panel-sub">' + record.wrongItems.length + ' 道</span></div>' +
        (record.wrongItems.length
          ? '<div class="exam-review-list">' + record.wrongItems.map(reviewItem).join('') + '</div>'
          : '<div class="exam-empty"><span class="exam-empty-icon">✓</span>本次练习没有错题。</div>') +
      '</section>';
  }

  /* ============================================================
   * 导出 / 导入
   * ============================================================ */
  function exportHistory() {
    if (!history.length) {
      toast('还没有练习记录可导出');
      return;
    }
    var now = new Date();
    var stamp = now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate()) +
      '-' + pad2(now.getHours()) + pad2(now.getMinutes());
    var payload = {
      v: 1,
      type: 'dm-exam-history',
      exportedAt: now.toISOString(),
      records: history
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'dm-exam-history-' + stamp + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1200);
    toast('已导出 ' + history.length + ' 条练习记录');
  }

  function importHistory() {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file) readImportFile(file);
      if (input.parentNode) input.parentNode.removeChild(input);
    });
    input.click();
  }

  function readImportFile(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(String(reader.result || ''));
        var incoming = Array.isArray(data) ? data : (data && Array.isArray(data.records) ? data.records : null);
        if (!incoming) throw new Error('format');
        var byId = {};
        history.forEach(function (r) { byId[r.id] = r; });
        var added = 0;
        var updated = 0;
        var invalid = 0;
        incoming.forEach(function (raw) {
          var r = normalizeRecord(raw);
          if (!r) { invalid += 1; return; }
          if (byId[r.id]) {
            if (r.finishedAt > byId[r.id].finishedAt) {
              byId[r.id] = r;
              updated += 1;
            }
          } else {
            byId[r.id] = r;
            added += 1;
          }
        });
        history = Object.keys(byId).map(function (k) { return byId[k]; })
          .sort(function (a, b) { return b.finishedAt - a.finishedAt; })
          .slice(0, MAX_RECORDS);
        saveHistory(history);
        if (view === 'history') renderHistory();
        else if (view === 'history-detail') renderHistory();
        else renderHome();
        var parts = [];
        if (added) parts.push('新增 ' + added + ' 条');
        if (updated) parts.push('更新 ' + updated + ' 条');
        if (invalid) parts.push('忽略 ' + invalid + ' 条无效记录');
        toast(parts.length ? '导入完成：' + parts.join('，') : '没有新的练习记录可导入');
      } catch (e) {
        toast('导入失败：不是有效的练习历史文件');
      }
    };
    reader.onerror = function () { toast('读取文件失败'); };
    reader.readAsText(file);
  }

  /* ============================================================
   * 事件
   * ============================================================ */
  function bindEvents() {
    app.addEventListener('click', function (e) {
      var btn = closest(e.target, '[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');

      if (act === 'start') {
        var draft = readDraft();
        if (draft) {
          showModal({
            title: '重新开始练习？',
            body: '当前有一次未完成的练习（已答 ' + Object.keys(draft.answers || {}).length + ' / ' + draft.ids.length + '）。重新开始会覆盖原有进度。',
            confirmText: '重新开始',
            cancelText: '继续上次',
            onConfirm: function () { clearDraft(); startSession(); }
          });
        } else {
          startSession();
        }
        return;
      }

      if (act === 'resume') { resumeDraft(); return; }
      if (act === 'home') { saveDraft(); renderHome(); return; }
      if (act === 'history') { saveDraft(); renderHistory(); return; }
      if (act === 'history-detail') { renderHistoryDetail(btn.getAttribute('data-id')); return; }
      if (act === 'history-delete') { confirmDelete(btn.getAttribute('data-id')); return; }
      if (act === 'history-clear') { confirmClear(); return; }
      if (act === 'history-export') { exportHistory(); return; }
      if (act === 'history-import') { importHistory(); return; }
      if (act === 'history-wrong') {
        var rec = recordById(btn.getAttribute('data-id'));
        if (rec) renderReview(rec.wrongItems, true, 'history-detail', '返回记录', rec.id);
        return;
      }
      if (act === 'history-all') {
        var recAll = recordById(btn.getAttribute('data-id'));
        if (recAll) {
          var allItems = itemsFromRecord(recAll, false);
          if (!allItems.length) toast('题库已更新，无法还原这份记录');
          else renderReview(allItems, false, 'history-detail', '返回记录', recAll.id);
        }
        return;
      }
      if (act === 'history-redo') {
        var r = recordById(btn.getAttribute('data-id'));
        if (r) redoWrong(r);
        return;
      }

      if (act === 'pick') { pickOption(Number(btn.getAttribute('data-index'))); return; }
      if (act === 'prev') { goTo(session ? session.index - 1 : 0); return; }
      if (act === 'next') { goTo(session ? session.index + 1 : 0); return; }
      if (act === 'jump') { goTo(Number(btn.getAttribute('data-index'))); return; }
      if (act === 'submit') { finishSession(false); return; }
      if (act === 'sheet-toggle') { toggleSheet(); return; }
      if (act === 'sheet-close') { closeSheet(); return; }

      if (act === 'review-wrong' && session) { renderReview(itemsFromSession(true), true, 'result', '返回结果'); return; }
      if (act === 'review-all' && session) { renderReview(itemsFromSession(false), false, 'result', '返回结果'); return; }
      if (act === 'retry-wrong' && session && session.record) {
        startSession(session.record.wrongItems.map(function (it) { return it.id; }));
        return;
      }
      if (act === 'result') { view = 'result'; renderResult(); return; }
    });

    document.addEventListener('keydown', function (e) {
      if (view !== 'quiz' || !session || session.finished) return;
      if ($('.exam-modal')) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(session.index - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(session.index + 1); }
      else if (/^[1-6]$/.test(e.key)) {
        var idx = Number(e.key) - 1;
        var q = currentQuestions()[session.index];
        if (q && idx < q.options.length) { e.preventDefault(); pickOption(idx); }
      }
    });
  }

  function confirmDelete(id) {
    var record = recordById(id);
    if (!record) return;
    showModal({
      title: '删除这条练习记录？',
      body: record.examTitle + ' · ' + fmtDate(record.finishedAt) + ' · ' + record.score + ' 分。删除后无法恢复。',
      confirmText: '删除',
      danger: true,
      onConfirm: function () {
        history = history.filter(function (r) { return r.id !== id; });
        saveHistory(history);
        renderHistory();
        toast('已删除该条记录');
      }
    });
  }

  function confirmClear() {
    showModal({
      title: '清空全部练习历史？',
      body: '将删除本站所有章节共 ' + history.length + ' 条练习记录，包括错题快照。建议先导出备份。',
      confirmText: '全部清空',
      danger: true,
      onConfirm: function () {
        history = [];
        saveHistory(history);
        renderHistory();
        toast('已清空练习历史');
      }
    });
  }

  function redoWrong(record) {
    var ids = record.wrongItems.map(function (it) { return it.id; });
    var valid = resolveQuestions(ids);
    if (!valid.length) {
      toast('题库已更新，无法定位这份记录中的错题');
      return;
    }
    startSession(valid.map(function (q) { return q.id; }));
  }

  /* ============================================================
   * 启动
   * ============================================================ */
  function boot() {
    app = document.getElementById('examApp');
    if (!app) return;
    examId = app.getAttribute('data-exam') || '';
    bankMap = window.DM_EXAM_BANKS || {};
    exam = bankMap[examId];
    if (!exam || !Array.isArray(exam.questions) || !exam.questions.length) {
      app.innerHTML = '<section class="exam-panel"><div class="exam-empty">题库加载失败，请检查页面是否引入了对应的题库脚本。</div></section>';
      return;
    }
    exam.path = exam.path || (window.location.pathname.split('/').pop() || '');
    history = readHistory();
    bindEvents();
    renderHome();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
