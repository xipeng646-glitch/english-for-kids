'use strict';
/* 四年级英语小帮手 — 纯前端逻辑。
   发音用浏览器自带的 speechSynthesis；学习记录存在 localStorage，
   并通过云端代理同步到私有仓库（见下面“云同步”一节），换设备也能接着学。
   页面源码里没有任何密钥：token 只存在服务器的环境变量里。 */

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

/* ---------------- 本地存储 ---------------- */
var LS = {
  stars: 'kidEngStars',
  lastDay: 'kidEngLastDay',
  streak: 'kidEngStreak',
  custom: 'kidEngCustom',
  edits: 'kidEngEdits',
  deleted: 'kidEngDeleted',
  wrong: 'kidEngWrong'
};
function lsGet(key, fallback) {
  try {
    var v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  /* 学习进度一变就约 1 秒后同步到云端（syncApplying 时正在应用云端数据，不触发） */
  if (!syncApplying && PROGRESS_KEYS.indexOf(key) !== -1) scheduleSync();
}

/* ---------------- 生词本 ---------------- */
/* 存储格式：{ 单词id: { count: 错过次数, last: "YYYY-MM-DD" } } */
function loadWrong() {
  var m = lsGet(LS.wrong, {});
  if (!m || typeof m !== 'object' || Array.isArray(m)) return {};
  return m;
}
function saveWrong(m) { lsSet(LS.wrong, m); }
function recordWrong(id) {
  var m = loadWrong();
  var e = m[id] || { count: 0, last: '' };
  e.count = e.count + 1;
  e.last = dayStr(new Date());
  m[id] = e;
  saveWrong(m);
  updateWrongBadge();
}
function clearWrong(id) {
  var m = loadWrong();
  if (m[id]) { delete m[id]; saveWrong(m); }
  updateWrongBadge();
}
function getWrongWords() {
  var m = loadWrong();
  var all = getAllWords();
  var byId = {};
  all.forEach(function (w) { byId[w.id] = w; });
  var stale = false;
  var list = [];
  Object.keys(m).forEach(function (id) {
    if (byId[id]) list.push({ word: byId[id], count: m[id].count, last: m[id].last });
    else stale = true;
  });
  if (stale) { /* 清掉已被家长删除的单词 */
    var clean = {};
    list.forEach(function (it) { clean[it.word.id] = { count: it.count, last: it.last }; });
    saveWrong(clean);
  }
  /* 错得多的排前面，同次数按最近错的排前面 */
  list.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return b.last < a.last ? -1 : (b.last > a.last ? 1 : 0);
  });
  return list;
}
function updateWrongBadge() {
  var badge = $('#wrongCountBadge');
  if (!badge) return;
  var n = getWrongWords().length;
  badge.textContent = n;
  badge.style.display = n > 0 ? '' : 'none';
}

/* ---------------- 云同步（经 Vercel 代理） ---------------- */
/* 同步目标：私有仓库 xipeng646-glitch/english-for-kids-sync 里的 progress.json。
   浏览器不直接碰 GitHub API，页面里没有任何 token：请求先发到 Vercel 上的
   代理函数（见 sync-api/api/sync.js），token 只存在 Vercel 服务器的环境变量里。
   SYNC_API_URL 换成部署好的代理地址就能用；还是占位地址时同步保持关闭。
   同步失败（离线、被挡）时静默跳过，只用本地记录，绝不弹窗报错。 */
var SYNC_API_URL = "https://english-for-kids-sync-api.vercel.app/api/sync";
var PROGRESS_KEYS = [LS.stars, LS.lastDay, LS.streak, LS.wrong, LS.custom];
var syncReady = false;     /* 初始云端同步完成前，不推本地改动，避免和初始合并抢写 */
var syncApplying = false;  /* 正在把云端数据写回本地时，不触发新的同步 */
var syncTimer = null;
var syncInFlight = false;
var syncPending = false;
var syncStatusText = '☁️ 云同步：正在准备…';

function syncEnabled() {
  /* 只有填了真实代理地址才开启；还是占位地址时不发任何请求 */
  return typeof fetch === 'function' &&
    typeof SYNC_API_URL === 'string' &&
    SYNC_API_URL.indexOf('REPLACE-WITH-VERCEL-URL') === -1;
}
function timeNow() {
  var d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function setSyncStatus(text) {
  syncStatusText = text;
  var el = $('#syncStatus');
  if (el) el.textContent = text;
}

/* 把本地记录拼成一份云端 progress 对象 */
function collectProgress() {
  var wrong = loadWrong();
  var ww = {};
  Object.keys(wrong).forEach(function (id) {
    ww[id] = { count: wrong[id].count, lastWrong: wrong[id].last };
  });
  return {
    stars: lsGet(LS.stars, 0),
    streak: lsGet(LS.streak, 0),
    lastDay: lsGet(LS.lastDay, null),
    wrongWords: ww,
    customWords: lsGet(LS.custom, [])
  };
}
/* 把一份 progress 对象写回本地（不触发同步），并刷新界面 */
function applyProgress(p, rerender) {
  if (!p || typeof p !== 'object') return;
  syncApplying = true;
  try {
    lsSet(LS.stars, p.stars || 0);
    lsSet(LS.streak, p.streak || 0);
    lsSet(LS.lastDay, p.lastDay || null);
    var wrong = {};
    var ww = p.wrongWords || {};
    Object.keys(ww).forEach(function (id) {
      wrong[id] = { count: ww[id].count || 0, last: ww[id].lastWrong || '' };
    });
    lsSet(LS.wrong, wrong);
    lsSet(LS.custom, p.customWords || []);
  } finally {
    syncApplying = false;
  }
  stars = lsGet(LS.stars, 0);
  streak = lsGet(LS.streak, 0);
  updateStats();
  updateWrongBadge();
  renderUnits();
  if (rerender) refreshMode();
}
/* 合并规则（本地 a，云端 b）：
   stars 取较大值；streak/lastDay 取 lastDay 较新的那一边（同天取较大 streak）；
   wrongWords 取并集，同词 count 取较大值、lastWrong 取较晚日期；
   customWords 按 id 取并集，同 id 保留本地版本。
   注意：这个合并没有“删除标记”——在一台设备上删掉的自加单词，
   或答对后移出的生词，如果另一台设备还没同步到，合并后会重新出现。 */
function mergeProgress(a, b) {
  a = a || {};
  b = b || {};
  var out = {
    stars: Math.max(a.stars || 0, b.stars || 0),
    streak: 0,
    lastDay: null,
    wrongWords: {},
    customWords: []
  };
  var aDay = a.lastDay || '', bDay = b.lastDay || '';
  if (bDay > aDay || (bDay === aDay && (b.streak || 0) > (a.streak || 0))) {
    out.streak = b.streak || 0; out.lastDay = b.lastDay || null;
  } else {
    out.streak = a.streak || 0; out.lastDay = a.lastDay || null;
  }
  var ww = {};
  [a.wrongWords || {}, b.wrongWords || {}].forEach(function (src) {
    Object.keys(src).forEach(function (id) {
      var e = src[id] || {};
      if (!ww[id]) ww[id] = { count: 0, lastWrong: '' };
      ww[id].count = Math.max(ww[id].count, e.count || 0);
      if ((e.lastWrong || '') > ww[id].lastWrong) ww[id].lastWrong = e.lastWrong;
    });
  });
  out.wrongWords = ww;
  var seen = {};
  (a.customWords || []).concat(b.customWords || []).forEach(function (w) {
    if (w && w.id && !seen[w.id]) { seen[w.id] = true; out.customWords.push(w); }
  });
  return out;
}
/* 取云端进度：返回 { status, sha, data }；云端还没有文件时 data 为 null。
   代理返回的 content 已经是解析好的 progress 对象，不是 base64。 */
function proxyGetFile() {
  return fetch(SYNC_API_URL).then(function (resp) {
    if (resp.status === 404) return { status: 404, sha: null, data: null };
    if (!resp.ok) throw new Error('get failed: ' + resp.status);
    return resp.json().then(function (j) {
      return { status: resp.status, sha: j.sha || null, data: j.content || null };
    });
  });
}
/* 写云端进度：body 是 { content: progress对象, sha }；返回 { status, ok }。
   sha 对不上时代理返回 409。请求里没有任何 Authorization 头。 */
function proxyPutFile(obj, sha) {
  return fetch(SYNC_API_URL, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: obj, sha: sha || null })
  }).then(function (resp) {
    return { status: resp.status, ok: resp.ok };
  });
}
/* 把本地进度推上云端：先取后写；409（别人先写了）时重新取、重新合并、再试一次 */
function doPush() {
  if (!syncEnabled()) return Promise.resolve();
  if (syncInFlight) { syncPending = true; return Promise.resolve(); }
  syncInFlight = true;
  setSyncStatus('☁️ 正在同步…');
  var local = collectProgress();
  return proxyGetFile().then(function (got) {
    var merged = got.data ? mergeProgress(local, got.data) : local;
    if (got.data && JSON.stringify(merged) === JSON.stringify(got.data)) {
      if (JSON.stringify(merged) !== JSON.stringify(local)) applyProgress(merged, false);
      setSyncStatus('☁️ 已同步 ' + timeNow());
      return;
    }
    return proxyPutFile(merged, got.sha).then(function (put) {
      if (put.status === 409) {
        return proxyGetFile().then(function (got2) {
          var merged2 = got2.data ? mergeProgress(collectProgress(), got2.data) : collectProgress();
          return proxyPutFile(merged2, got2.sha).then(function (put2) {
            if (put2.ok) { setSyncStatus('☁️ 已同步 ' + timeNow()); }
            else { setSyncStatus('☁️ 仅保存在本机'); }
          });
        });
      }
      if (put.ok) {
        if (JSON.stringify(merged) !== JSON.stringify(collectProgress())) applyProgress(merged, false);
        setSyncStatus('☁️ 已同步 ' + timeNow());
      } else {
        setSyncStatus('☁️ 仅保存在本机');
      }
    });
  }).catch(function () {
    /* 离线 / 被挡 / token 失效：静默失败，本地继续用 */
    setSyncStatus('☁️ 仅保存在本机');
  }).then(function () {
    syncInFlight = false;
    if (syncPending) { syncPending = false; scheduleSync(); }
  });
}
/* 本地改动后约 1 秒推一次云端（防抖：连续改动只推最后一次） */
function scheduleSync() {
  if (!syncEnabled() || !syncReady) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(function () { syncTimer = null; doPush(); }, 1000);
}
/* 打开应用时：先用本地记录立刻显示，再取云端合并 */
function initSync() {
  if (!syncEnabled()) { syncReady = true; setSyncStatus('☁️ 云同步：未设置'); return; }
  setSyncStatus('☁️ 正在同步…');
  proxyGetFile().then(function (got) {
    var local = collectProgress();
    if (!got.data) return doPush(); /* 云端还没有文件：把本地推上去 */
    var merged = mergeProgress(local, got.data);
    if (JSON.stringify(merged) !== JSON.stringify(local)) applyProgress(merged, true);
    if (JSON.stringify(merged) !== JSON.stringify(got.data)) return doPush();
    setSyncStatus('☁️ 已同步 ' + timeNow());
  }).catch(function () {
    setSyncStatus('☁️ 仅保存在本机');
  }).then(function () {
    syncReady = true;
    scheduleSync(); /* 把初始化期间发生的改动推上去 */
  });
}

/* ---------------- 同步码（手动跨设备，不走网络也能传进度） ---------------- */
/* 同步码 = progress 对象的 JSON 经 base64url 编码（无填充），一串字符就能
   把星星、生词本、自加单词带到另一台设备。代理万一连不上时也能用。 */
function b64urlEncode(s) {
  return btoa(unescape(encodeURIComponent(s)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  var b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return decodeURIComponent(escape(atob(b64)));
}
function exportSyncCode() {
  return b64urlEncode(JSON.stringify(collectProgress()));
}
function copyText(text) {
  var msg = $('#syncCodeMsg');
  function done(ok) {
    if (msg) msg.textContent = ok ? '已复制 ✅ 发到另一台设备上粘贴导入。' : '复制失败，请手动长按选中复制。';
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallbackCopy(); });
  } else {
    fallbackCopy();
  }
  function fallbackCopy() {
    var out = $('#syncCodeOut');
    if (!out) { done(false); return; }
    out.focus();
    out.select();
    try { done(document.execCommand('copy')); }
    catch (e) { done(false); }
  }
}
function importSyncCode(code) {
  var raw = String(code || '').trim();
  function say(t) {
    var m = $('#syncCodeMsg');
    if (m) m.textContent = t;
  }
  if (!raw) { say('请先粘贴同步码。'); return; }
  var parsed = null;
  try {
    parsed = JSON.parse(b64urlDecode(raw));
  } catch (e) { parsed = null; }
  /* 真正的同步码一定包含进度字段；随便一个 JSON 对象（比如 {"foo":"bar"}）不算 */
  var KNOWN = ['stars', 'streak', 'lastDay', 'wrongWords', 'customWords'];
  var hasKnown = false;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    for (var i = 0; i < KNOWN.length; i++) {
      if (Object.prototype.hasOwnProperty.call(parsed, KNOWN[i])) { hasKnown = true; break; }
    }
  }
  if (!hasKnown) {
    say('同步码不对，请重新复制');
    return;
  }
  /* 用同一个合并函数合并，再写回本地并刷新界面 */
  var merged = mergeProgress(collectProgress(), parsed);
  applyProgress(merged, true);
  say('已导入 ✅ 正在同步到云端…');
  if (syncEnabled()) {
    if (syncReady) scheduleSync(); else doPush();
  }
}

var stars = lsGet(LS.stars, 0);
var streak = 0;
var currentUnit = 'all';
var mode = 'cards';
var pool = [];
var cardIdx = 0;
var flipped = false;
var quiz = null;
var editingId = null;

/* ---------------- 连续天数 ---------------- */
function dayStr(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function updateStreak() {
  var today = dayStr(new Date());
  var yest = dayStr(new Date(Date.now() - 86400000));
  var last = lsGet(LS.lastDay, null);
  var s = lsGet(LS.streak, 0);
  if (last === today) { streak = s; }
  else if (last === yest) { streak = s + 1; }
  else { streak = 1; }
  lsSet(LS.lastDay, today);
  lsSet(LS.streak, streak);
}
function updateStats() {
  $('#starCount').textContent = stars;
  $('#streakCount').textContent = streak;
}

/* ---------------- 单词数据（含家长改动） ---------------- */
function getAllWords() {
  var edits = lsGet(LS.edits, {});
  var deleted = lsGet(LS.deleted, []);
  var custom = lsGet(LS.custom, []);
  var list = WORDS.filter(function (w) { return deleted.indexOf(w.id) === -1; })
    .map(function (w) { return edits[w.id] ? edits[w.id] : w; });
  return list.concat(custom);
}
function getPool() {
  var all = getAllWords();
  if (currentUnit === 'all') return all;
  var p = all.filter(function (w) { return w.unit === currentUnit; });
  return p.length ? p : all;
}
function unitName(unitId) {
  for (var i = 0; i < UNITS.length; i++) {
    if (UNITS[i].id === unitId) return UNITS[i].book + ' Unit ' + UNITS[i].n + ' · ' + UNITS[i].zh;
  }
  return '自加单词';
}

/* ---------------- 发音 ---------------- */
var enVoice = null;
function pickVoice() {
  var vs = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  for (var i = 0; i < vs.length; i++) {
    if (vs[i].lang && vs[i].lang.toLowerCase().indexOf('en-us') === 0) { enVoice = vs[i]; return; }
  }
  for (var j = 0; j < vs.length; j++) {
    if (vs[j].lang && vs[j].lang.toLowerCase().indexOf('en') === 0) { enVoice = vs[j]; return; }
  }
}
if (window.speechSynthesis) {
  pickVoice();
  window.speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.8;
    u.pitch = 1.0;
    if (enVoice) u.voice = enVoice;
    window.speechSynthesis.speak(u);
  } catch (e) {}
}

/* ---------------- 工具 ---------------- */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function addStars(n) {
  stars += n;
  lsSet(LS.stars, stars);
  updateStats();
}

/* ---------------- 单元选择 ---------------- */
function renderUnits() {
  var box = $('#unitPicker');
  var all = getAllWords();
  var html = '<button class="unit-btn' + (currentUnit === 'all' ? ' active' : '') +
    '" data-unit="all">📚 全部单词 <span class="count">' + all.length + '</span></button>';
  UNITS.forEach(function (u) {
    var c = all.filter(function (w) { return w.unit === u.id; }).length;
    html += '<button class="unit-btn' + (currentUnit === u.id ? ' active' : '') + '" data-unit="' + u.id + '">' +
      u.book + ' U' + u.n + ' · ' + u.zh + '<br><span class="unit-en">' + esc(u.title) + '</span> ' +
      '<span class="count">' + c + '</span></button>';
  });
  box.innerHTML = html;
  $$('#unitPicker .unit-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      currentUnit = b.getAttribute('data-unit');
      cardIdx = 0;
      quiz = null;
      renderUnits();
      refreshMode();
    });
  });
}

/* ---------------- 模式切换 ---------------- */
function setMode(m) {
  mode = m;
  $$('.mode-btn').forEach(function (b) {
    b.classList.toggle('active', b.getAttribute('data-mode') === m);
  });
  $$('.mode-panel').forEach(function (p) { p.style.display = 'none'; });
  $('#panel-' + m).style.display = 'block';
  refreshMode();
}
function refreshMode() {
  if (mode === 'cards') { pool = getPool(); cardIdx = 0; showCard(false); }
  else if (mode === 'parent') { renderParent(); }
  else if (mode === 'wrong') { renderWrong(); }
  else { quizBoxEl().innerHTML = quizIntroHtml(); }
}
function quizIntroHtml() {
  var p = getPool();
  var spellPool = p.filter(function (w) { return /^[a-z]+$/.test(w.en); });
  return '<div class="quiz-intro"><p class="big">准备好啦吗？🎮</p>' +
    '<p>这个单元一共有 <b>' + p.length + '</b> 个单词，每轮考 <b>10</b> 道题。</p>' +
    '<p>答对 1 题得 1 颗 ⭐，加油！</p>' +
    '<button class="big-btn green" id="startQuizBtn">开始 ▶</button>' +
    (mode === 'spell' ? '<p class="tip">拼写小测验只考单个单词（比如 apple），词组不考拼写哦。</p><p class="tip">可拼写的单词：' + spellPool.length + ' 个。</p>' : '') +
    '</div>';
}

/* ---------------- 单词卡片 ---------------- */
function showCard(autoSpeak) {
  pool = getPool();
  if (!pool.length) {
    $('#cardBox').innerHTML = '<p class="big">这个单元还没有单词 😢<br>去家长模式添加吧！</p>';
    $('#cardCounter').textContent = '';
    return;
  }
  if (cardIdx < 0) cardIdx = pool.length - 1;
  if (cardIdx >= pool.length) cardIdx = 0;
  var w = pool[cardIdx];
  flipped = false;
  var badge = (w.custom ? ' <span class="tag">家长加的</span>' : '') + (w.edited ? ' <span class="tag">已修改</span>' : '');
  $('#cardBox').innerHTML =
    '<div class="card3d" id="flashCard">' +
      '<div class="card-inner" id="cardInner">' +
        '<div class="card-face card-front">' +
          '<div class="card-emoji">' + esc(w.emoji || '⭐') + '</div>' +
          '<div class="card-word">' + esc(w.en) + '</div>' +
          '<button class="speak-btn" id="speakFront" title="读一读">🔊 读一读</button>' +
          '<div class="flip-hint">点卡片翻过来，看中文意思 👆</div>' +
        '</div>' +
        '<div class="card-face card-back">' +
          '<div class="card-zh">' + esc(w.zh) + badge + '</div>' +
          '<div class="card-ex">' + esc(w.ex || '') + '</div>' +
          '<button class="speak-btn" id="speakBack" title="读一读">🔊 再读一遍</button>' +
          '<div class="flip-hint">点卡片翻回去 👆</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  $('#cardCounter').textContent = '第 ' + (cardIdx + 1) + ' / ' + pool.length + ' 张 · ' + unitName(w.unit);
  $('#flashCard').addEventListener('click', function () {
    flipped = !flipped;
    $('#cardInner').classList.toggle('flipped', flipped);
  });
  $('#speakFront').addEventListener('click', function (e) { e.stopPropagation(); speak(w.en); });
  $('#speakBack').addEventListener('click', function (e) { e.stopPropagation(); speak(w.en); });
  if (autoSpeak) speak(w.en);
}
function bindCardButtons() {
  $('#prevCard').addEventListener('click', function () { cardIdx--; showCard(true); });
  $('#nextCard').addEventListener('click', function () { cardIdx++; showCard(true); });
  $('#shuffleCards').addEventListener('click', function () {
    pool = shuffle(getPool());
    cardIdx = 0;
    showCard(true);
  });
}

/* ---------------- 小测验 ---------------- */
function quizBoxEl() { return $('#quizBox-' + mode); }
function startQuiz() {
  var p = getPool();
  if (mode === 'spell') {
    p = p.filter(function (w) { return /^[a-z]+$/.test(w.en); });
    if (p.length < 4) p = getAllWords().filter(function (w) { return /^[a-z]+$/.test(w.en); });
  }
  if (p.length < 4) {
    quizBoxEl().innerHTML = '<p class="big">这个单元的单词太少啦，换个单元试试吧！😅</p>';
    return;
  }
  var qs = shuffle(p).slice(0, Math.min(10, p.length));
  quiz = { questions: qs, idx: 0, correct: 0, earned: 0, answered: false };
  renderQuestion();
}
function renderQuestion() {
  var q = quiz.questions[quiz.idx];
  var all = getPool();
  var distract = shuffle(all.filter(function (w) { return w.id !== q.id; })).slice(0, 3);
  while (distract.length < 3) {
    var extra = shuffle(getAllWords().filter(function (w) { return w.id !== q.id && distract.indexOf(w) === -1; })).slice(0, 3 - distract.length);
    distract = distract.concat(extra);
  }
  var choices = shuffle([q].concat(distract));
  var html = '<div class="quiz-progress">第 ' + (quiz.idx + 1) + ' / ' + quiz.questions.length + ' 题 &nbsp;·&nbsp; 已答对 ' + quiz.correct + ' 题</div>';
  if (mode === 'listen') {
    html += '<div class="quiz-prompt"><p class="big">仔细听 🔊，选出你听到的单词</p>' +
      '<button class="big-btn blue" id="replayBtn">🔊 再听一遍</button></div>' +
      '<div class="options">' + choices.map(function (c) {
        return '<button class="opt-btn" data-id="' + c.id + '"><span class="opt-emoji">' + esc(c.emoji || '⭐') + '</span><br>' + esc(c.en) + '</button>';
      }).join('') + '</div>';
  } else if (mode === 'wordquiz') {
    html += '<div class="quiz-prompt"><p class="big">这个中文是哪个英文单词？</p>' +
      '<div class="quiz-zh">' + esc(q.emoji || '⭐') + ' ' + esc(q.zh) + '</div></div>' +
      '<div class="options">' + choices.map(function (c) {
        return '<button class="opt-btn" data-id="' + c.id + '">' + esc(c.en) + '</button>';
      }).join('') + '</div>';
  } else if (mode === 'spell') {
    html += '<div class="quiz-prompt"><p class="big">仔细听 🔊，拼出这个单词</p>' +
      '<button class="big-btn blue" id="replayBtn">🔊 再听一遍</button>' +
      '<div class="spell-hint">中文提示：' + esc(q.zh) + ' ' + esc(q.emoji || '') + '</div></div>' +
      '<div class="spell-row"><input id="spellInput" type="text" placeholder="在这里输入单词…" autocomplete="off" autocapitalize="off" spellcheck="false">' +
      '<button class="big-btn green" id="checkSpellBtn">检查 ✅</button></div>';
  }
  html += '<div class="feedback" id="feedback"></div>';
  html += '<div class="quiz-next" id="quizNext"></div>';
  quizBoxEl().innerHTML = html;
  quiz.answered = false;
  if (mode === 'listen' || mode === 'spell') {
    speak(q.en);
    var rb = $('#replayBtn');
    if (rb) rb.addEventListener('click', function () { speak(q.en); });
  }
  if (mode === 'spell') {
    var input = $('#spellInput');
    input.focus();
    $('#checkSpellBtn').addEventListener('click', function () { checkSpelling(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') checkSpelling(input.value); });
  } else {
    Array.prototype.slice.call(quizBoxEl().querySelectorAll('.opt-btn')).forEach(function (b) {
      b.addEventListener('click', function () { answerChoice(b.getAttribute('data-id')); });
    });
  }
}
function answerChoice(choiceId) {
  if (!quiz || quiz.answered) return;
  quiz.answered = true;
  var q = quiz.questions[quiz.idx];
  var ok = choiceId === q.id;
  Array.prototype.slice.call(quizBoxEl().querySelectorAll('.opt-btn')).forEach(function (b) {
    b.disabled = true;
    if (b.getAttribute('data-id') === q.id) b.classList.add('correct');
    else if (b.getAttribute('data-id') === choiceId) b.classList.add('wrong');
  });
  showFeedback(ok, q);
}
function checkSpelling(value) {
  if (!quiz || quiz.answered) return;
  var q = quiz.questions[quiz.idx];
  var typed = String(value || '').trim().toLowerCase();
  var ok = typed === q.en.toLowerCase();
  quiz.answered = true;
  $('#spellInput').disabled = true;
  $('#checkSpellBtn').disabled = true;
  showFeedback(ok, q);
}
function showFeedback(ok, q) {
  var fb = quizBoxEl().querySelector('#feedback');
  if (ok) {
    quiz.correct++;
    quiz.earned++;
    addStars(1);
    clearWrong(q.id); /* 答对了 → 从生词本移出 */
    fb.innerHTML = '<div class="fb-good">✅ 答对了！太棒了！+1 ⭐<br><span class="fb-word">' + esc(q.en) + ' · ' + esc(q.zh) + '</span></div>';
    speak(q.en);
  } else {
    recordWrong(q.id); /* 答错了 → 记进生词本 */
    fb.innerHTML = '<div class="fb-bad">❌ 不对哦，别灰心！正确答案是：<br><span class="fb-word">' + esc(q.en) + ' · ' + esc(q.zh) + '</span><br>再听一听，记住它！</div>';
    speak(q.en);
  }
  var last = quiz.idx >= quiz.questions.length - 1;
  quizBoxEl().querySelector('#quizNext').innerHTML = '<button class="big-btn orange" id="nextQBtn">' + (last ? '看成绩 🏆' : '下一题 ➜') + '</button>';
  quizBoxEl().querySelector('#nextQBtn').addEventListener('click', function () {
    if (last) { finishQuiz(); }
    else { quiz.idx++; renderQuestion(); }
  });
}
function finishQuiz() {
  var total = quiz.questions.length;
  var c = quiz.correct;
  var msg;
  if (c === total) msg = '满分！你真是英语小明星！🌟🌟🌟';
  else if (c >= total * 0.8) msg = '太厉害了！就差一点点就满分！🎉';
  else if (c >= total * 0.6) msg = '很不错！继续加油！💪';
  else msg = '没关系，多练几次就会啦！明天再来试试！🌈';
  quizBoxEl().innerHTML = '<div class="quiz-result"><p class="big">本轮成绩</p>' +
    '<div class="score">' + c + ' / ' + total + '</div>' +
    '<p>' + msg + '</p>' +
    '<p>本轮得了 <b>' + quiz.earned + ' ⭐</b>，一共 <b>' + stars + ' ⭐</b></p>' +
    '<button class="big-btn green" id="againBtn">再来一轮 🔄</button> ' +
    '<button class="big-btn blue" id="backCardsBtn">回单词卡 🃏</button></div>';
  $('#againBtn').addEventListener('click', startQuiz);
  $('#backCardsBtn').addEventListener('click', function () { setMode('cards'); });
}

/* ---------------- 生词本 ---------------- */
var wrongPool = [];   /* 当前生词本里的单词对象（已按错次排序） */
var wrongIdx = 0;
var wrongFlipped = false;
var wrongView = 'cards'; /* 'cards' 看卡片 / 'quiz' 考一考 */
var wq = null;        /* 生词本小测验状态 */

function renderWrong() {
  var box = $('#wrongBox');
  var list = getWrongWords();
  updateWrongBadge();
  var html = '<div class="parent-note">📕 生词本：这里是你答错过的单词，多练几遍就记住啦！<br>生词本保存在这台设备上，也会同步到云端，换手机也能接着练。</div>';
  if (!list.length) {
    box.innerHTML = html +
      '<p class="big">太棒了，一个生词也没有！🎉</p>' +
      '<p class="tip">去测验里练一练，答错的单词会自动跑到这里来。</p>' +
      '<div class="quiz-next"><button class="big-btn orange" id="wrongEmptyBtn">去练一练 🎮</button></div>';
    $('#wrongEmptyBtn').addEventListener('click', function () { setMode('cards'); });
    return;
  }
  wrongPool = list.map(function (it) { return it.word; });
  if (wrongIdx >= wrongPool.length) wrongIdx = 0;
  html += '<div class="quiz-next" style="margin-top:0">' +
    '<button class="big-btn ' + (wrongView === 'cards' ? 'orange' : 'blue') + '" id="wrongCardsTab">🃏 看卡片</button> ' +
    '<button class="big-btn ' + (wrongView === 'quiz' ? 'orange' : 'blue') + '" id="wrongQuizTab">✏️ 考一考</button></div>' +
    '<p class="tip">生词 ' + list.length + ' 个 · 错得多的排在前面</p>' +
    '<div id="wrongViewBox"></div>';
  box.innerHTML = html;
  $('#wrongCardsTab').addEventListener('click', function () { wrongView = 'cards'; renderWrong(); });
  $('#wrongQuizTab').addEventListener('click', function () { wrongView = 'quiz'; renderWrong(); });
  if (wrongView === 'cards') showWrongCard(false);
  else startWrongQuiz();
}
function showWrongCard(autoSpeak) {
  var view = $('#wrongViewBox');
  if (!view) return;
  var list = getWrongWords();
  wrongPool = list.map(function (it) { return it.word; });
  if (!wrongPool.length) { renderWrong(); return; }
  if (wrongIdx < 0) wrongIdx = wrongPool.length - 1;
  if (wrongIdx >= wrongPool.length) wrongIdx = 0;
  var w = wrongPool[wrongIdx];
  var info = null;
  for (var i = 0; i < list.length; i++) { if (list[i].word.id === w.id) { info = list[i]; break; } }
  wrongFlipped = false;
  view.innerHTML =
    '<div class="card3d" id="wrongCard">' +
      '<div class="card-inner" id="wrongCardInner">' +
        '<div class="card-face card-front">' +
          '<div class="card-emoji">' + esc(w.emoji || '⭐') + '</div>' +
          '<div class="card-word">' + esc(w.en) + '</div>' +
          '<button class="speak-btn" id="wrongSpeakFront" title="读一读">🔊 读一读</button>' +
          '<div class="flip-hint">点卡片翻过来，看中文意思 👆</div>' +
        '</div>' +
        '<div class="card-face card-back">' +
          '<div class="card-zh">' + esc(w.zh) + '</div>' +
          '<div class="card-ex">' + esc(w.ex || '') + '</div>' +
          '<button class="speak-btn" id="wrongSpeakBack" title="读一读">🔊 再读一遍</button>' +
          '<div class="flip-hint">点卡片翻回去 👆</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="card-counter">第 ' + (wrongIdx + 1) + ' / ' + wrongPool.length + ' 个生词 · 错过 ' + (info ? info.count : 1) + ' 次 · ' + unitName(w.unit) + '</div>' +
    '<div class="card-nav">' +
      '<button class="big-btn blue" id="wrongPrev">⬅️ 上一个</button>' +
      '<button class="big-btn green" id="wrongKnown">✅ 我会了</button>' +
      '<button class="big-btn blue" id="wrongNext">下一个 ➡️</button>' +
    '</div>';
  $('#wrongCard').addEventListener('click', function () {
    wrongFlipped = !wrongFlipped;
    $('#wrongCardInner').classList.toggle('flipped', wrongFlipped);
  });
  $('#wrongSpeakFront').addEventListener('click', function (e) { e.stopPropagation(); speak(w.en); });
  $('#wrongSpeakBack').addEventListener('click', function (e) { e.stopPropagation(); speak(w.en); });
  $('#wrongPrev').addEventListener('click', function () { wrongIdx--; showWrongCard(true); });
  $('#wrongNext').addEventListener('click', function () { wrongIdx++; showWrongCard(true); });
  $('#wrongKnown').addEventListener('click', function () {
    clearWrong(w.id); /* 卡片上点“我会了”，也从生词本移出 */
    renderWrong();
  });
  if (autoSpeak) speak(w.en);
}
function startWrongQuiz() {
  var view = $('#wrongViewBox');
  if (!view) return;
  var list = getWrongWords();
  if (!list.length) { renderWrong(); return; }
  var qs = shuffle(list.map(function (it) { return it.word; })).slice(0, Math.min(10, list.length));
  wq = { questions: qs, idx: 0, correct: 0, answered: false };
  renderWrongQuestion();
}
function renderWrongQuestion() {
  var view = $('#wrongViewBox');
  var q = wq.questions[wq.idx];
  var distract = shuffle(getAllWords().filter(function (w) { return w.id !== q.id; })).slice(0, 3);
  var choices = shuffle([q].concat(distract));
  view.innerHTML = '<div class="quiz-progress">生词测验 · 第 ' + (wq.idx + 1) + ' / ' + wq.questions.length + ' 题 &nbsp;·&nbsp; 已答对 ' + wq.correct + ' 题</div>' +
    '<div class="quiz-prompt"><p class="big">这个中文是哪个英文单词？</p>' +
    '<div class="quiz-zh">' + esc(q.emoji || '⭐') + ' ' + esc(q.zh) + '</div></div>' +
    '<div class="options">' + choices.map(function (c) {
      return '<button class="opt-btn" data-id="' + c.id + '">' + esc(c.en) + '</button>';
    }).join('') + '</div>' +
    '<div class="feedback" id="wrongFeedback"></div>' +
    '<div class="quiz-next" id="wrongNextBox"></div>';
  wq.answered = false;
  Array.prototype.slice.call(view.querySelectorAll('.opt-btn')).forEach(function (b) {
    b.addEventListener('click', function () { answerWrongChoice(b.getAttribute('data-id')); });
  });
}
function answerWrongChoice(choiceId) {
  if (!wq || wq.answered) return;
  wq.answered = true;
  var view = $('#wrongViewBox');
  var q = wq.questions[wq.idx];
  var ok = choiceId === q.id;
  Array.prototype.slice.call(view.querySelectorAll('.opt-btn')).forEach(function (b) {
    b.disabled = true;
    if (b.getAttribute('data-id') === q.id) b.classList.add('correct');
    else if (b.getAttribute('data-id') === choiceId) b.classList.add('wrong');
  });
  var fb = view.querySelector('#wrongFeedback');
  if (ok) {
    wq.correct++;
    addStars(1);
    clearWrong(q.id); /* 答对了 → 从生词本移出 */
    fb.innerHTML = '<div class="fb-good">✅ 答对了！这个词已经从生词本移出啦！+1 ⭐<br><span class="fb-word">' + esc(q.en) + ' · ' + esc(q.zh) + '</span></div>';
  } else {
    recordWrong(q.id); /* 又答错了 → 错次 +1 */
    fb.innerHTML = '<div class="fb-bad">❌ 不对哦，正确答案是：<br><span class="fb-word">' + esc(q.en) + ' · ' + esc(q.zh) + '</span><br>它还在生词本里，再练一练！</div>';
  }
  speak(q.en);
  var last = wq.idx >= wq.questions.length - 1;
  view.querySelector('#wrongNextBox').innerHTML = '<button class="big-btn orange" id="wrongNextQBtn">' + (last ? '看成绩 🏆' : '下一题 ➜') + '</button>';
  view.querySelector('#wrongNextQBtn').addEventListener('click', function () {
    if (last) finishWrongQuiz();
    else { wq.idx++; renderWrongQuestion(); }
  });
}
function finishWrongQuiz() {
  var view = $('#wrongViewBox');
  var total = wq.questions.length;
  var c = wq.correct;
  var left = getWrongWords().length;
  view.innerHTML = '<div class="quiz-result"><p class="big">生词测验完成！</p>' +
    '<div class="score">' + c + ' / ' + total + '</div>' +
    '<p>' + (c === total ? '全部答对，生词本清空啦！🌟🌟🌟' : '答对 ' + c + ' 个，生词本里还剩 ' + left + ' 个，继续加油！💪') + '</p>' +
    '<button class="big-btn green" id="wrongAgainBtn">再考一轮 🔄</button> ' +
    '<button class="big-btn blue" id="wrongBackBtn">回生词卡片 🃏</button></div>';
  $('#wrongAgainBtn').addEventListener('click', function () { wrongView = 'quiz'; startWrongQuiz(); });
  $('#wrongBackBtn').addEventListener('click', function () { wrongView = 'cards'; wrongIdx = 0; renderWrong(); });
}

/* ---------------- 家长模式 ---------------- */
function renderParent() {
  var list = getPool();
  var box = $('#parentBox');
  var unitOptions = UNITS.map(function (u) {
    return '<option value="' + u.id + '"' + (currentUnit === u.id ? ' selected' : '') + '>' + u.book + ' Unit ' + u.n + ' · ' + u.zh + '</option>';
  }).join('');
  var html = '<div class="parent-note">👨‍👩‍👧 家长模式：添加、修改、删除单词。<br><span id="syncStatus">' + esc(syncStatusText) + '</span></div>' +
    '<div class="parent-form">' +
    '<h3 id="formTitle">➕ 添加新单词</h3>' +
    '<label>英文单词 <input id="pfEn" type="text" placeholder="例如：apple" autocomplete="off"></label>' +
    '<label>中文意思 <input id="pfZh" type="text" placeholder="例如：苹果" autocomplete="off"></label>' +
    '<label>表情符号 <input id="pfEmoji" type="text" placeholder="例如：🍎" maxlength="4"></label>' +
    '<label>放在哪个单元 <select id="pfUnit">' + unitOptions + '</select></label>' +
    '<label>例句（可以不填） <input id="pfEx" type="text" placeholder="例如：I like apples." autocomplete="off"></label>' +
    '<div class="form-btns"><button class="big-btn green" id="pfSave">保存单词 💾</button>' +
    '<button class="big-btn gray" id="pfCancel" style="display:none">取消</button></div>' +
    '<div class="form-msg" id="pfMsg"></div></div>' +
    '<div class="parent-form">' +
    '<h3>🔄 换设备同步</h3>' +
    '<p class="tip" style="text-align:left">想在另一台手机或电脑上接着学？点“导出同步码”，把代码发到那台设备上，在它的家长模式里粘贴导入就行。同步码里只有星星、生词本和自加单词。</p>' +
    '<div class="form-btns"><button class="big-btn blue" id="exportCodeBtn">导出同步码 📋</button></div>' +
    '<textarea id="syncCodeOut" readonly rows="3" placeholder="点“导出同步码”，这里会出现一串代码"></textarea>' +
    '<div class="form-btns"><button class="small-btn" id="copyCodeBtn">📋 复制同步码</button></div>' +
    '<label>导入同步码 <textarea id="syncCodeIn" rows="3" placeholder="把另一台设备上的同步码粘贴到这里"></textarea></label>' +
    '<div class="form-btns"><button class="big-btn green" id="importCodeBtn">导入同步码 ✅</button></div>' +
    '<div class="form-msg" id="syncCodeMsg"></div></div>' +
    '<div class="parent-list-head"><h3>本单元单词（' + list.length + ' 个）</h3>' +
    '<button class="small-btn" id="restoreBtn">↩️ 恢复被删除的单词</button></div>' +
    '<div class="parent-list">' + list.map(function (w) {
      return '<div class="parent-row"><span class="pr-emoji">' + esc(w.emoji || '⭐') + '</span>' +
        '<span class="pr-word"><b>' + esc(w.en) + '</b> · ' + esc(w.zh) +
        (w.custom ? ' <span class="tag">家长加的</span>' : '') + (w.edited ? ' <span class="tag">已修改</span>' : '') + '</span>' +
        '<span class="pr-btns"><button class="small-btn" data-edit="' + w.id + '">✏️ 修改</button>' +
        '<button class="small-btn danger" data-del="' + w.id + '">🗑️ 删除</button></span></div>';
    }).join('') + '</div>';
  box.innerHTML = html;
  $('#pfSave').addEventListener('click', saveParentWord);
  $('#pfCancel').addEventListener('click', resetParentForm);
  $('#exportCodeBtn').addEventListener('click', function () {
    var out = $('#syncCodeOut');
    out.value = exportSyncCode();
    out.focus();
    out.select();
    $('#syncCodeMsg').textContent = '同步码已生成，点“复制同步码”再发到另一台设备上。';
  });
  $('#copyCodeBtn').addEventListener('click', function () {
    var out = $('#syncCodeOut');
    if (!out.value) { $('#syncCodeMsg').textContent = '先点“导出同步码”生成代码。'; return; }
    copyText(out.value);
  });
  $('#importCodeBtn').addEventListener('click', function () {
    importSyncCode($('#syncCodeIn').value);
  });
  $('#restoreBtn').addEventListener('click', function () {
    lsSet(LS.deleted, []);
    renderParent(); renderUnits(); updateWrongBadge();
    $('#pfMsg').textContent = '已恢复所有被删除的单词 ✅';
  });
  $$('#parentBox [data-edit]').forEach(function (b) {
    b.addEventListener('click', function () { startEdit(b.getAttribute('data-edit')); });
  });
  $$('#parentBox [data-del]').forEach(function (b) {
    b.addEventListener('click', function () { deleteWord(b.getAttribute('data-del')); });
  });
}
function resetParentForm() {
  editingId = null;
  $('#formTitle').textContent = '➕ 添加新单词';
  $('#pfEn').value = ''; $('#pfZh').value = ''; $('#pfEmoji').value = ''; $('#pfEx').value = '';
  $('#pfCancel').style.display = 'none';
  $('#pfMsg').textContent = '';
}
function startEdit(id) {
  var w = null;
  var all = getAllWords();
  for (var i = 0; i < all.length; i++) { if (all[i].id === id) { w = all[i]; break; } }
  if (!w) return;
  editingId = id;
  $('#formTitle').textContent = '✏️ 正在修改：' + w.en;
  $('#pfEn').value = w.en;
  $('#pfZh').value = w.zh;
  $('#pfEmoji').value = w.emoji || '';
  $('#pfUnit').value = w.unit;
  $('#pfEx').value = w.ex || '';
  $('#pfCancel').style.display = 'inline-block';
  $('#pfMsg').textContent = '改好后点“保存单词”';
  window.scrollTo({ top: $('#parentBox').offsetTop - 10, behavior: 'smooth' });
}
function saveParentWord() {
  var en = $('#pfEn').value.trim();
  var zh = $('#pfZh').value.trim();
  var emoji = $('#pfEmoji').value.trim() || '⭐';
  var unit = $('#pfUnit').value;
  var ex = $('#pfEx').value.trim();
  var msg = $('#pfMsg');
  if (!en || !zh) { msg.textContent = '请把英文单词和中文意思都填上哦！'; return; }
  if (editingId) {
    var isCustom = editingId.indexOf('c-') === 0;
    var updated = { id: editingId, unit: unit, en: en, zh: zh, ex: ex, emoji: emoji, custom: isCustom, edited: !isCustom };
    if (isCustom) {
      var custom = lsGet(LS.custom, []);
      for (var i = 0; i < custom.length; i++) { if (custom[i].id === editingId) custom[i] = updated; }
      lsSet(LS.custom, custom);
    } else {
      var edits = lsGet(LS.edits, {});
      edits[editingId] = updated;
      lsSet(LS.edits, edits);
    }
    msg.textContent = '已保存修改 ✅';
  } else {
    var custom2 = lsGet(LS.custom, []);
    custom2.push({ id: 'c-' + Date.now(), unit: unit, en: en, zh: zh, ex: ex, emoji: emoji, custom: true });
    lsSet(LS.custom, custom2);
    msg.textContent = '已添加新单词 ✅';
  }
  resetParentForm();
  renderParent();
  renderUnits();
}
function deleteWord(id) {
  var w = null;
  var all = getAllWords();
  for (var i = 0; i < all.length; i++) { if (all[i].id === id) { w = all[i]; break; } }
  if (!w) return;
  if (!window.confirm('确定要删除 "' + w.en + '（' + w.zh + '）" 吗？')) return;
  if (id.indexOf('c-') === 0) {
    var custom = lsGet(LS.custom, []).filter(function (x) { return x.id !== id; });
    lsSet(LS.custom, custom);
  } else {
    var deleted = lsGet(LS.deleted, []);
    if (deleted.indexOf(id) === -1) deleted.push(id);
    lsSet(LS.deleted, deleted);
    var edits = lsGet(LS.edits, {});
    delete edits[id];
    lsSet(LS.edits, edits);
  }
  renderParent();
  renderUnits();
  updateWrongBadge();
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', function () {
  updateStreak();
  updateStats();
  updateWrongBadge();
  renderUnits();
  bindCardButtons();
  $$('.mode-btn').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'startQuizBtn') startQuiz();
  });
  setMode('cards');
  initSync();
});
