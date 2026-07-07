// ============================================================
// SEData — 資料載入層（fetch data/*.json，帶 ?v= 防快取）
// ============================================================
window.SEData = (function() {
  'use strict';

  var cache = {};
  var V = window.APP_VERSION || '0';

  function fetchJson(name) {
    if (cache[name]) return Promise.resolve(cache[name]);
    return fetch('data/' + name + '.json?v=' + V).then(function(r) {
      if (!r.ok) throw new Error(name + ' HTTP ' + r.status);
      return r.json();
    }).then(function(j) {
      cache[name] = j;
      return j;
    });
  }

  function getPlan() { return fetchJson('plan'); }
  function getGrammar() { return fetchJson('grammar'); }
  function getWriting() { return fetchJson('writing'); }
  function getVocabWeek(w) { return fetchJson('vocab_w' + w); }
  function getReadingWeek(w) { return fetchJson('reading_w' + w); }

  // ── 日期工具 ──
  var START = '2026-07-06', END = '2026-08-30';
  function toDate(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(d) {
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  }
  function weekOf(dateStr) {
    var diff = Math.floor((toDate(dateStr) - toDate(START)) / 86400000);
    if (diff < 0 || diff > 55) return 0;
    return Math.floor(diff / 7) + 1; // 1..8
  }
  function dayIndex(dateStr) { // 0=週一 .. 6=週日
    var diff = Math.floor((toDate(dateStr) - toDate(START)) / 86400000);
    return ((diff % 7) + 7) % 7;
  }
  function inRange(dateStr) { return weekOf(dateStr) >= 1; }
  function todayStr() { return fmt(new Date()); }

  // 載入某日完整內容 {date, week, dayIdx, words, grammar, article, writingWeek}
  function getDay(dateStr) {
    var w = weekOf(dateStr);
    if (!w) return Promise.resolve(null);
    var di = dayIndex(dateStr);
    return Promise.all([getVocabWeek(w), getReadingWeek(w), getGrammar(), getPlan()])
      .then(function(res) {
        var vw = res[0], rw = res[1], grammar = res[2], plan = res[3];
        var dayVocab = (vw.days || []).find(function(d) { return d.date === dateStr; });
        var article = (rw.articles || []).find(function(a) { return a.date === dateStr; });
        var weekInfo = (plan.weeks || []).find(function(x) { return x.week === w; }) || {};
        var gIds = weekInfo.grammar || [];
        // 週一~三第 1 個文法、週四~六第 2 個、週日兩個都複習
        var gList;
        if (di <= 2) gList = [gIds[0]];
        else if (di <= 5) gList = [gIds[1]];
        else gList = gIds.slice();
        var gObjs = gList.map(function(id) {
          return grammar.find(function(g) { return g.id === id; });
        }).filter(Boolean);
        return {
          date: dateStr, week: w, dayIdx: di,
          theme: weekInfo.theme || '',
          words: dayVocab ? dayVocab.words : [],
          grammars: gObjs,
          article: article || null,
          isSunday: di === 6
        };
      });
  }

  // 載入全部單字（8 週）— 分類庫/錯題本用
  function getAllVocab() {
    var ws = [1, 2, 3, 4, 5, 6, 7, 8].map(getVocabWeek);
    return Promise.all(ws);
  }
  function getAllReading() {
    var ws = [1, 2, 3, 4, 5, 6, 7, 8].map(getReadingWeek);
    return Promise.all(ws);
  }
  // 用 id 找單字
  function findWord(id) {
    return getAllVocab().then(function(weeks) {
      for (var i = 0; i < weeks.length; i++) {
        var days = weeks[i].days || [];
        for (var j = 0; j < days.length; j++) {
          var hit = (days[j].words || []).find(function(w) { return w.id === id; });
          if (hit) return hit;
        }
      }
      return null;
    });
  }
  function findArticle(id) {
    return getAllReading().then(function(weeks) {
      for (var i = 0; i < weeks.length; i++) {
        var hit = (weeks[i].articles || []).find(function(a) { return a.id === id; });
        if (hit) return hit;
      }
      return null;
    });
  }

  return {
    START: START, END: END,
    getPlan: getPlan, getGrammar: getGrammar, getWriting: getWriting,
    getVocabWeek: getVocabWeek, getReadingWeek: getReadingWeek,
    getDay: getDay, getAllVocab: getAllVocab, getAllReading: getAllReading,
    findWord: findWord, findArticle: findArticle,
    weekOf: weekOf, dayIndex: dayIndex, inRange: inRange, todayStr: todayStr, fmt: fmt, toDate: toDate
  };
})();
