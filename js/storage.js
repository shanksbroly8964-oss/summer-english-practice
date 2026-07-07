// ============================================================
// SEStore — localStorage 儲存層 + 雲端合併邏輯
// keys: se_done / se_wrong / se_stats / se_settings / se_writing
// ============================================================
window.SEStore = (function() {
  'use strict';

  var K = {
    done: 'se_done',        // { "2026-07-06": {vocab:1,grammar:1,reading:1,quiz:1,score:"9/11"} }
    wrong: 'se_wrong',      // [ {k,t,ref,q,wrongCount,ts} ]
    stats: 'se_stats',      // { answered, correct, quizzes }
    settings: 'se_settings',// { ttsNormal:false }
    writing: 'se_writing'   // { "w1-0": "my sentence" }
  };

  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* quota */ }
    scheduleSync();
  }

  // ── done ──
  function getDone() { return get(K.done, {}); }
  function markDone(date, part, extra) {
    var d = getDone();
    d[date] = d[date] || {};
    d[date][part] = 1;
    if (extra) Object.keys(extra).forEach(function(k) { d[date][k] = extra[k]; });
    set(K.done, d);
  }
  function isDayComplete(rec) {
    return !!(rec && rec.vocab && rec.grammar && rec.reading && rec.quiz);
  }

  // ── wrongbook ──
  function getWrong() { return get(K.wrong, []); }
  function addWrong(item) {
    var list = getWrong();
    var hit = list.find(function(w) { return w.k === item.k; });
    if (hit) {
      hit.wrongCount = (hit.wrongCount || 1) + 1;
      hit.ts = Date.now();
    } else {
      item.wrongCount = 1;
      item.ts = Date.now();
      list.push(item);
    }
    set(K.wrong, list);
    updateBadge();
  }
  function removeWrong(k) {
    var list = getWrong().filter(function(w) { return w.k !== k; });
    set(K.wrong, list);
    updateBadge();
  }
  function updateBadge() {
    var el = document.getElementById('wrong-badge');
    if (!el) return;
    var n = getWrong().length;
    el.hidden = n === 0;
    el.textContent = n > 99 ? '99+' : n;
  }

  // ── stats ──
  function getStats() { return get(K.stats, { answered: 0, correct: 0, quizzes: 0 }); }
  function recordAnswer(ok) {
    var s = getStats();
    s.answered++;
    if (ok) s.correct++;
    set(K.stats, s);
  }
  function recordQuizFinish() {
    var s = getStats();
    s.quizzes++;
    set(K.stats, s);
  }

  // ── settings / writing ──
  function getSettings() { return get(K.settings, {}); }
  function setSetting(key, val) {
    var s = getSettings(); s[key] = val; set(K.settings, s);
  }
  function getWriting() { return get(K.writing, {}); }
  function saveWriting(id, text) {
    var w = getWriting(); w[id] = text; set(K.writing, w);
  }

  // ── 雲端同步（Firestore users/{uid}.summer，merge:true）──
  var syncTimer = null;
  function scheduleSync() {
    if (!window.SEAuth || !window.SEAuth.getUser()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(pushToCloud, 1500);
  }
  function snapshot() {
    return {
      done: getDone(), wrong: getWrong(), stats: getStats(),
      settings: getSettings(), writing: getWriting(), updatedAt: Date.now()
    };
  }
  function pushToCloud() {
    if (!window.SEAuth || !window.SEAuth.getUser()) return;
    window.SEAuth.syncProgress({ summer: snapshot() });
  }
  // 雲端資料與本機「聯集式」合併（不丟資料）：
  // done 取聯集、wrong 依 k 合併取較大 wrongCount、stats 取較大值、writing 聯集（雲端優先較新）
  function mergeCloud(cloud) {
    if (!cloud) return;
    var d = getDone();
    Object.keys(cloud.done || {}).forEach(function(date) {
      d[date] = Object.assign({}, cloud.done[date], d[date]);
    });
    try { localStorage.setItem(K.done, JSON.stringify(d)); } catch (e) {}

    var localW = getWrong();
    var byK = {};
    localW.concat(cloud.wrong || []).forEach(function(w) {
      if (!byK[w.k] || (w.wrongCount || 0) > (byK[w.k].wrongCount || 0)) byK[w.k] = w;
    });
    try { localStorage.setItem(K.wrong, JSON.stringify(Object.keys(byK).map(function(k) { return byK[k]; }))); } catch (e) {}

    var s = getStats(), cs = cloud.stats || {};
    s.answered = Math.max(s.answered, cs.answered || 0);
    s.correct = Math.max(s.correct, cs.correct || 0);
    s.quizzes = Math.max(s.quizzes, cs.quizzes || 0);
    try { localStorage.setItem(K.stats, JSON.stringify(s)); } catch (e) {}

    var w = Object.assign({}, getWriting(), cloud.writing || {});
    // 本機有打字的以本機為準
    var localWr = getWriting();
    Object.keys(localWr).forEach(function(k) { if (localWr[k]) w[k] = localWr[k]; });
    try { localStorage.setItem(K.writing, JSON.stringify(w)); } catch (e) {}

    updateBadge();
  }

  return {
    getDone: getDone, markDone: markDone, isDayComplete: isDayComplete,
    getWrong: getWrong, addWrong: addWrong, removeWrong: removeWrong, updateBadge: updateBadge,
    getStats: getStats, recordAnswer: recordAnswer, recordQuizFinish: recordQuizFinish,
    getSettings: getSettings, setSetting: setSetting,
    getWriting: getWriting, saveWriting: saveWriting,
    snapshot: snapshot, pushToCloud: pushToCloud, mergeCloud: mergeCloud
  };
})();
