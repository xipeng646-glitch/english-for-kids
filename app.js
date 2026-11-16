'use strict';
/* 四年级英语小帮手 — 纯前端逻辑，无任何网络请求。
   发音用浏览器自带的 speechSynthesis；星星和连续天数存在 localStorage。 */

var $ = function (s) { return document.querySelector(s); };
var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

/* ---------------- 本地存储 ---------------- */
var LS = {
  stars: 'kidEngStars',
  lastDay: 'kidEngLastDay',
  streak: 'kidEngStreak',
  custom: 'kidEngCustom',
  edits: 'kidEngEdits',
  deleted: 'kidEngDeleted'
};
function lsGet(key, fallback) {
  try {
    var v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
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
    fb.innerHTML = '<div class="fb-good">✅ 答对了！太棒了！+1 ⭐<br><span class="fb-word">' + esc(q.en) + ' · ' + esc(q.zh) + '</span></div>';
    speak(q.en);
  } else {
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

/* ---------------- 家长模式 ---------------- */
function renderParent() {
  var list = getPool();
  var box = $('#parentBox');
  var unitOptions = UNITS.map(function (u) {
    return '<option value="' + u.id + '"' + (currentUnit === u.id ? ' selected' : '') + '>' + u.book + ' Unit ' + u.n + ' · ' + u.zh + '</option>';
  }).join('');
  var html = '<div class="parent-note">👨‍👩‍👧 家长模式：添加、修改、删除单词。改动只保存在这台设备上，不会上传到网上。</div>' +
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
  $('#restoreBtn').addEventListener('click', function () {
    lsSet(LS.deleted, []);
    renderParent(); renderUnits();
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
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', function () {
  updateStreak();
  updateStats();
  renderUnits();
  bindCardButtons();
  $$('.mode-btn').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });
  document.addEventListener('click', function (e) {
    if (e.target && e.target.id === 'startQuizBtn') startQuiz();
  });
  setMode('cards');
});
