// ============================================================
// SEListening — 聽音選字題產生器（純邏輯，無 DOM）
// 慣例：answer 一律為「選項全文」，比對用字串 ===
// 輸出 schema 與 js/quiz.js 既有題目相容
// ============================================================
window.SEListening = (function() {
  'use strict';

  // Fisher-Yates；自備，不 import 別檔
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 從 arr 隨機取 n 個（不重複）
  function pickRandom(arr, n) {
    return shuffle(arr).slice(0, Math.min(n, arr.length));
  }

  function makeQuestions(words, n) {
    if (!Array.isArray(words) || words.length === 0) return [];
    var want = n || 0;
    if (want <= 0) return [];

    // 隨機挑 want 個；池不夠就取全部
    var picked = pickRandom(words, want);

    return picked.map(function(word) {
      // 干擾取自「其他字」的 zh；若池不足 3 個就盡量取（保證 answer 一定在 options 內）
      var others = words.filter(function(w) { return w.id !== word.id; });
      var distractors = pickRandom(others, 3).map(function(w) { return w.zh; });

      var options = shuffle([word.zh].concat(distractors));

      return {
        k: 'l:' + word.id,
        t: 'listening',
        q: '🔊 聽發音，選出正確的中文意思',
        audio: { scope: 'word', id: word.id, fallbackText: word.en },
        options: options,
        answer: word.zh,
        explain: word.en + ' ' + word.kk + ' ' + word.zh
      };
    });
  }

  return { makeQuestions: makeQuestions };
})();
