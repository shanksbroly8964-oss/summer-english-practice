// ============================================================
// SEQuiz — 測驗引擎 + 錯題重組
// 慣例：answer 一律為「選項全文」，比對用字串 ===
// ============================================================
window.SEQuiz = (function() {
  'use strict';

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // ── 單字題產生（隨機方向 + 隨機干擾選項）──
  // pool: 干擾用單字陣列（不含目標字）
  function makeVocabQ(word, pool) {
    var others = shuffle(pool.filter(function(w) { return w.id !== word.id; })).slice(0, 3);
    var dir = Math.random() < 0.5 ? 'e2z' : 'z2e';
    var q, options, answer, tts;
    if (dir === 'e2z') {
      q = '「' + word.en + '」的中文意思是？';
      answer = word.zh;
      options = shuffle([word.zh].concat(others.map(function(w) { return w.zh; })));
      tts = word.en;
    } else {
      q = '「' + word.zh + '」的英文是？';
      answer = word.en;
      options = shuffle([word.en].concat(others.map(function(w) { return w.en; })));
      tts = null;
    }
    return {
      k: 'v:' + word.id, t: 'vocab', q: q, options: options, answer: answer,
      tts: tts, explain: word.en + ' ' + word.kk + ' ' + word.pos + ' ' + word.zh + '\n例句：' + word.ex
    };
  }

  function makeGrammarQ(g, idx) {
    var item = g.quiz[idx];
    return {
      k: 'g:' + g.id + ':' + idx, t: 'grammar',
      q: item.q, options: shuffle(item.options.slice()), answer: item.answer,
      explain: '文法重點：' + g.name + '｜' + g.pattern
    };
  }

  function makeReadingQ(article, idx, withContext) {
    var item = article.questions[idx];
    return {
      k: 'r:' + article.id + ':' + idx, t: 'reading',
      q: item.q, options: shuffle(item.options.slice()), answer: item.answer,
      context: withContext ? (article.title + '\n\n' + article.text) : null,
      explain: '出自文章：' + article.title
    };
  }

  // ── 每日測驗：6 單字 + 文法題 + 3 閱讀 ──
  function buildDailyQuiz(day) {
    return window.SEData.getVocabWeek(day.week).then(function(vw) {
      var weekPool = [];
      (vw.days || []).forEach(function(d) { weekPool = weekPool.concat(d.words || []); });

      var qs = [];
      day.words.forEach(function(w) { qs.push(makeVocabQ(w, weekPool)); });
      // 聽音選字（新聽力題型）：從當日單字出 3 題，播真人發音選中文
      if (window.SEListening) {
        qs = qs.concat(window.SEListening.makeQuestions(day.words, 3));
      }
      day.grammars.forEach(function(g) {
        (g.quiz || []).forEach(function(_, i) { qs.push(makeGrammarQ(g, i)); });
      });
      if (day.article) {
        day.article.questions.forEach(function(_, i) {
          qs.push(makeReadingQ(day.article, i, true));
        });
      }
      return qs; // 順序：單字→聽力→文法→閱讀（閱讀附原文）
    });
  }

  // ── 錯題重練：隨機抽最多 limit 題，重新洗選項 ──
  function buildWrongQuiz(limit) {
    var wrongs = shuffle(window.SEStore.getWrong()).slice(0, limit || 10);
    if (!wrongs.length) return Promise.resolve([]);

    return Promise.all([window.SEData.getAllVocab(), window.SEData.getAllReading(), window.SEData.getGrammar()])
      .then(function(res) {
        var allWords = [];
        res[0].forEach(function(wk) {
          (wk.days || []).forEach(function(d) { allWords = allWords.concat(d.words || []); });
        });
        var allArticles = [];
        res[1].forEach(function(wk) { allArticles = allArticles.concat(wk.articles || []); });
        var grammar = res[2];

        var qs = [];
        wrongs.forEach(function(w) {
          var parts = w.k.split(':');
          if (w.t === 'vocab') {
            var word = allWords.find(function(x) { return x.id === parts[1]; });
            if (word) qs.push(makeVocabQ(word, allWords));
          } else if (w.t === 'grammar') {
            var g = grammar.find(function(x) { return x.id === parts[1]; });
            var gi = +parts[2];
            if (g && g.quiz && g.quiz[gi]) qs.push(makeGrammarQ(g, gi));
          } else if (w.t === 'reading') {
            var art = allArticles.find(function(x) { return x.id === parts[1]; });
            var ri = +parts[2];
            if (art && art.questions[ri]) qs.push(makeReadingQ(art, ri, true));
          } else if (w.t === 'listening') {
            var lword = allWords.find(function(x) { return x.id === parts[1]; });
            if (lword) {
              var others = shuffle(allWords.filter(function(x) { return x.id !== lword.id; }))
                             .slice(0, 3).map(function(x) { return x.zh; });
              qs.push({
                k: 'l:' + lword.id, t: 'listening', q: '🔊 聽發音，選出正確的中文意思',
                audio: { scope: 'word', id: lword.id, fallbackText: lword.en },
                options: shuffle([lword.zh].concat(others)), answer: lword.zh,
                explain: lword.en + ' ' + lword.kk + ' ' + lword.zh
              });
            }
          }
        });
        return qs;
      });
  }

  // ── 測驗執行器 ──
  // opts: { mode:'daily'|'wrong', date?, onFinish? }
  function run(container, questions, opts) {
    opts = opts || {};
    var idx = 0, correct = 0;
    var total = questions.length;

    function renderQ() {
      var q = questions[idx];
      var pct = Math.round(idx / total * 100);
      var html =
        '<div class="card">' +
          '<div class="quiz-progress"><i style="width:' + pct + '%"></i></div>' +
          '<div class="sub">第 ' + (idx + 1) + ' / ' + total + ' 題' +
            (q.t === 'vocab' ? '｜單字' : q.t === 'grammar' ? '｜文法' : q.t === 'listening' ? '｜聽力' : '｜閱讀') + '</div>' +
          (q.context ? '<div class="quiz-context">' + esc(q.context) + '</div>' : '') +
          '<div class="quiz-q">' + esc(q.q) +
            (q.tts ? ' <button class="tts-btn" data-tts="' + esc(q.tts) + '" title="朗讀">🔊</button>' : '') +
            (q.audio ? ' <button class="tts-btn big listening-play" data-audio-scope="' + esc(q.audio.scope) +
              '" data-audio-id="' + esc(q.audio.id) + '" data-audio-fb="' + esc(q.audio.fallbackText) +
              '" title="再聽一次">🔊 再聽一次</button>' : '') +
          '</div>' +
          '<div class="quiz-opts">' +
            q.options.map(function(o) {
              return '<button data-opt="' + esc(o) + '">' + esc(o) + '</button>';
            }).join('') +
          '</div>' +
          '<div id="quiz-fb"></div>' +
        '</div>';
      container.innerHTML = html;

      // 聽力題：進題自動播一次真人發音
      if (q.audio && window.SEAudio) {
        window.SEAudio.play({ scope: q.audio.scope, id: q.audio.id, fallbackText: q.audio.fallbackText });
      }

      container.querySelectorAll('.quiz-opts button').forEach(function(btn) {
        btn.addEventListener('click', function() { answer(btn); });
      });
    }

    function answer(btn) {
      var q = questions[idx];
      var chosen = btn.getAttribute('data-opt');
      var ok = chosen === q.answer;

      container.querySelectorAll('.quiz-opts button').forEach(function(b) {
        b.disabled = true;
        var val = b.getAttribute('data-opt');
        if (val === q.answer) b.classList.add('correct');
        else if (b === btn && !ok) b.classList.add('wrong');
      });

      window.SEStore.recordAnswer(ok);
      if (ok) {
        correct++;
        if (opts.mode === 'wrong') window.SEStore.removeWrong(q.k); // 答對移除
      } else {
        window.SEStore.addWrong({ k: q.k, t: q.t, q: q.q });        // 答錯進錯題本
      }

      var fb = container.querySelector('#quiz-fb');
      fb.innerHTML =
        '<div class="quiz-feedback ' + (ok ? 'ok' : 'bad') + '">' +
          (ok ? '✅ 答對了！' : '❌ 答錯了，正確答案：' + esc(q.answer)) +
          (q.explain ? '<br><span class="sub">' + esc(q.explain).replace(/\n/g, '<br>') + '</span>' : '') +
          (opts.mode === 'wrong' ? '<br><span class="sub">' + (ok ? '已從錯題本移除 🎉' : '留在錯題本，下次再練') + '</span>' : '') +
        '</div>' +
        '<button class="btn block" id="quiz-next">' + (idx + 1 < total ? '下一題 →' : '看結果 🏁') + '</button>';
      fb.querySelector('#quiz-next').addEventListener('click', next);
    }

    function next() {
      window.SETts.stop();
      idx++;
      if (idx < total) renderQ();
      else finish();
    }

    function finish() {
      window.SEStore.recordQuizFinish();
      if (opts.mode === 'daily' && opts.date) {
        window.SEStore.markDone(opts.date, 'quiz', { score: correct + '/' + total });
      }
      var pct = total ? Math.round(correct / total * 100) : 0;
      var msg = pct === 100 ? '太強了！全對！🎉' : pct >= 80 ? '很棒！繼續保持！💪' :
                pct >= 60 ? '不錯喔，錯的再複習一下！' : '沒關係，錯題本會幫你複習！加油！';
      container.innerHTML =
        '<div class="card quiz-result">' +
          '<div class="score">' + correct + ' / ' + total + '</div>' +
          '<p style="margin:8px 0 4px;">' + msg + '</p>' +
          (total - correct > 0 ? '<p class="sub">答錯的 ' + (total - correct) + ' 題已加入錯題本 📌</p>' : '') +
          '<div class="btn-row">' +
            (opts.mode === 'daily'
              ? '<a class="btn ghost" href="#day/' + opts.date + '">回今日課程</a><a class="btn" href="#calendar">回行事曆</a>'
              : '<a class="btn ghost" href="#wrong">回錯題本</a>' +
                (window.SEStore.getWrong().length ? '<button class="btn orange" id="quiz-again">再練一輪</button>' : '<a class="btn" href="#calendar">回行事曆</a>')) +
          '</div>' +
        '</div>';
      var again = container.querySelector('#quiz-again');
      if (again && typeof opts.onAgain === 'function') again.addEventListener('click', opts.onAgain);
      if (typeof opts.onFinish === 'function') opts.onFinish(correct, total);
    }

    if (!total) {
      container.innerHTML = '<div class="empty-state"><div class="big">🎉</div>沒有題目可以練習</div>';
      return;
    }
    renderQ();
  }

  return { buildDailyQuiz: buildDailyQuiz, buildWrongQuiz: buildWrongQuiz, run: run, shuffle: shuffle, esc: esc };
})();
