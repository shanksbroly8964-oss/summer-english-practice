// ============================================================
// SEViews — 各頁面渲染
// ============================================================
window.SEViews = (function() {
  'use strict';

  var esc = function(s) { return window.SEQuiz.esc(s); };
  var D = function() { return window.SEData; };
  var S = function() { return window.SEStore; };

  var DOW = ['一', '二', '三', '四', '五', '六', '日'];

  function ttsBtn(text, big, label) {
    return '<button class="tts-btn' + (big ? ' big' : '') + '" data-tts="' + esc(text) + '" title="朗讀">🔊' +
      (label ? ' ' + esc(label) : '') + '</button>';
  }

  function speedToggleHtml() {
    var normal = S().getSettings().ttsNormal;
    return '<button class="speed-toggle' + (normal ? '' : ' slow') + '" id="speed-toggle">' +
      (normal ? '語速：正常 🚶' : '語速：慢速 🐢') + '</button>';
  }
  function bindSpeedToggle(el) {
    var btn = el.querySelector('#speed-toggle');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var cur = S().getSettings().ttsNormal;
      S().setSetting('ttsNormal', !cur);
      btn.classList.toggle('slow', cur);
      btn.textContent = !cur ? '語速：正常 🚶' : '語速：慢速 🐢';
    });
  }

  // ══════════════ 行事曆首頁 ══════════════
  function renderCalendar(el) {
    var done = S().getDone();
    var today = D().todayStr();
    var months = [{ y: 2026, m: 7, name: '2026 年 7 月' }, { y: 2026, m: 8, name: '2026 年 8 月' }];

    var doneCount = 0, total = 56;
    Object.keys(done).forEach(function(d) { if (S().isDayComplete(done[d])) doneCount++; });

    var html =
      '<div class="card" style="background:linear-gradient(120deg,#ecfeff,#fefce8);">' +
        '<h2>👋 每日四步驟</h2>' +
        '<p class="sub" style="line-height:1.9;">① 背 6 個單字 → ② 讀文法重點 → ③ 朗讀今日文章 → ④ 做測驗！<br>' +
        '完成進度：<b style="color:var(--c-primary)">' + doneCount + ' / ' + total + ' 天</b>' +
        (S().getWrong().length ? '｜錯題本還有 <b style="color:var(--c-bad)">' + S().getWrong().length + '</b> 題等你消滅 📌' : '') + '</p>' +
        (D().inRange(today) ? '<a class="btn orange block" href="#day/' + today + '">▶ 開始今天的課程（' + today.slice(5).replace('-', '/') + '）</a>' : '') +
      '</div>' +
      '<div class="cal-legend">' +
        '<span><i style="background:var(--c-done)"></i>已完成</span>' +
        '<span><i style="background:var(--c-today);border:2px solid var(--c-accent);box-sizing:border-box;"></i>今天</span>' +
        '<span><i style="background:#fff;box-shadow:var(--shadow)"></i>未完成</span>' +
      '</div>';

    months.forEach(function(mo) {
      var first = new Date(mo.y, mo.m - 1, 1);
      var daysInMonth = new Date(mo.y, mo.m, 0).getDate();
      var startDow = (first.getDay() + 6) % 7; // 週一=0
      html += '<div class="cal-month"><h3>' + mo.name + '</h3><div class="cal-grid">';
      DOW.forEach(function(d) { html += '<div class="cal-dow">' + d + '</div>'; });
      for (var i = 0; i < startDow; i++) html += '<div class="cal-cell empty"></div>';
      for (var day = 1; day <= daysInMonth; day++) {
        var ds = mo.y + '-0' + mo.m + '-' + (day < 10 ? '0' : '') + day;
        var inR = D().inRange(ds);
        var cls = 'cal-cell';
        var mark = '';
        if (!inR) cls += ' off';
        else {
          var rec = done[ds];
          if (S().isDayComplete(rec)) { cls += ' done'; mark = '✅'; }
          else if (rec && (rec.vocab || rec.grammar || rec.reading || rec.quiz)) mark = '✏️';
          else mark = D().dayIndex(ds) === 6 ? '📝' : '📖';
        }
        if (ds === today) cls += ' today';
        html += '<div class="' + cls + '"' + (inR ? ' data-date="' + ds + '"' : '') + '>' +
          '<span class="d">' + day + '</span><span class="m">' + mark + '</span></div>';
      }
      html += '</div></div>';
    });

    el.innerHTML = html;
    el.querySelectorAll('.cal-cell[data-date]').forEach(function(c) {
      c.addEventListener('click', function() { location.hash = '#day/' + c.getAttribute('data-date'); });
    });
  }

  // ══════════════ 日課頁 ══════════════
  function renderDay(el, dateStr, activeTab) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    D().getDay(dateStr).then(function(day) {
      if (!day) {
        el.innerHTML = '<div class="empty-state"><div class="big">🏖️</div>這一天不在暑假計畫範圍內<br>（2026/7/6 ~ 8/30）<br><br><a class="btn" href="#calendar">回行事曆</a></div>';
        return;
      }
      var prev = D().fmt(new Date(D().toDate(dateStr).getTime() - 86400000));
      var next = D().fmt(new Date(D().toDate(dateStr).getTime() + 86400000));
      var rec = S().getDone()[dateStr] || {};
      var tabs = [
        { id: 'vocab', label: '📖 單字' + (rec.vocab ? ' ✓' : '') },
        { id: 'grammar', label: '✏️ 文法' + (rec.grammar ? ' ✓' : '') },
        { id: 'reading', label: '📰 閱讀' + (rec.reading ? ' ✓' : '') }
      ];
      if (day.isSunday) tabs.push({ id: 'writing', label: '📝 寫作' });
      tabs.push({ id: 'quiz', label: '🎯 測驗' + (rec.quiz ? ' ✓' : '') });

      var tab = activeTab || 'vocab';
      var html =
        '<div class="day-nav">' +
          (D().inRange(prev) ? '<a class="btn ghost" style="padding:8px 14px" href="#day/' + prev + '">←</a>' : '<span style="width:48px"></span>') +
          '<div class="title"><b>' + dateStr.replace(/-/g, '/') + '（週' + DOW[day.dayIdx] + '）</b><br>' +
            '<span class="pill">第 ' + day.week + ' 週｜' + esc(day.theme) + '</span></div>' +
          (D().inRange(next) ? '<a class="btn ghost" style="padding:8px 14px" href="#day/' + next + '">→</a>' : '<span style="width:48px"></span>') +
        '</div>' +
        '<div class="section-tabs">' +
          tabs.map(function(t) {
            return '<button data-tab="' + t.id + '"' + (t.id === tab ? ' class="active"' : '') + '>' + t.label + '</button>';
          }).join('') +
        '</div>' +
        '<div id="day-body"></div>';
      el.innerHTML = html;

      el.querySelectorAll('.section-tabs button').forEach(function(b) {
        b.addEventListener('click', function() {
          window.SETts.stop();
          renderDay(el, dateStr, b.getAttribute('data-tab'));
        });
      });

      var body = el.querySelector('#day-body');
      if (tab === 'vocab') renderDayVocab(body, day);
      else if (tab === 'grammar') renderDayGrammar(body, day);
      else if (tab === 'reading') renderDayReading(body, day);
      else if (tab === 'writing') renderWritingWeek(body, day.week, true);
      else if (tab === 'quiz') renderDayQuiz(body, day);
    }).catch(function(err) {
      el.innerHTML = '<div class="empty-state">資料載入失敗：' + esc(err.message) + '</div>';
    });
  }

  function wordCardHtml(w) {
    return '<div class="word-card">' +
      '<div class="word-head">' +
        '<span class="word-en">' + esc(w.en) + '</span>' + ttsBtn(w.en) +
        '<span class="word-kk">' + esc(w.kk) + '</span>' +
        '<span class="word-pos">' + esc(w.pos) + '</span>' +
      '</div>' +
      '<div class="word-zh">' + esc(w.zh) + '</div>' +
      '<div class="word-ex">' + esc(w.ex) + ' ' + ttsBtn(w.ex) +
        '<span class="zh">' + esc(w.ex_zh) + '</span>' +
      '</div>' +
    '</div>';
  }

  function renderDayVocab(el, day) {
    var rec = S().getDone()[day.date] || {};
    el.innerHTML =
      '<div class="card"><h2>📖 今日單字（' + day.words.length + ' 個）' + speedToggleHtml() + '</h2>' +
        day.words.map(wordCardHtml).join('') +
        '<button class="btn block' + (rec.vocab ? ' ghost' : '') + '" id="mark-vocab">' +
          (rec.vocab ? '✅ 已完成單字（點我可再標記一次）' : '我背完今天的單字了 ✓') + '</button>' +
      '</div>';
    bindSpeedToggle(el);
    el.querySelector('#mark-vocab').addEventListener('click', function() {
      S().markDone(day.date, 'vocab');
      window.SEApp.toast('單字完成！✨');
      renderDay(document.getElementById('view'), day.date, 'grammar');
    });
  }

  function grammarCardHtml(g, compact) {
    return '<div' + (compact ? '' : ' class="card"') + '>' +
      '<h2>✏️ ' + esc(g.name) + ' <span class="pill orange">第 ' + g.week + ' 週文法</span></h2>' +
      '<div class="grammar-pattern">' + esc(g.pattern) + '</div>' +
      '<p style="font-size:.93rem;line-height:1.7;">' + esc(g.zh) + '</p>' +
      '<ul class="grammar-points">' + g.points.map(function(p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' +
      '<h2 style="margin-top:10px;font-size:.95rem;">例句（點 🔊 聽發音）</h2>' +
      g.examples.map(function(x) {
        return '<div class="gx">' + ttsBtn(x.en) + '<div><span class="en">' + esc(x.en) + '</span>' +
          '<span class="zh">' + esc(x.zh) + '</span></div></div>';
      }).join('') +
    '</div>';
  }

  function renderDayGrammar(el, day) {
    var rec = S().getDone()[day.date] || {};
    el.innerHTML =
      day.grammars.map(function(g) { return grammarCardHtml(g); }).join('') +
      '<div class="card"><button class="btn block' + (rec.grammar ? ' ghost' : '') + '" id="mark-grammar">' +
        (rec.grammar ? '✅ 已完成文法' : '我讀完今天的文法了 ✓') + '</button></div>';
    el.querySelector('#mark-grammar').addEventListener('click', function() {
      S().markDone(day.date, 'grammar');
      window.SEApp.toast('文法完成！✨');
      renderDay(document.getElementById('view'), day.date, 'reading');
    });
  }

  function articleHtml(a, day) {
    return '<h2>📰 ' + esc(a.title) + (day ? ' <span class="pill">' + a.date.slice(5).replace('-', '/') + '</span>' : '') + '</h2>' +
      '<div class="article-tools">' +
        ttsBtn(a.title + '. ' + a.text, true, '全文朗讀') +
        '<button class="tts-btn big" style="background:#64748b" onclick="window.SETts.stop()">⏹ 停止</button>' +
        speedToggleHtml() +
      '</div>' +
      '<div class="article-text">' + esc(a.text) + '</div>' +
      '<p class="sub">💡 口說練習：先聽一次全文朗讀，再自己大聲唸一遍！遇到不會唸的字，反白選起來多聽幾次。</p>';
  }

  function renderDayReading(el, day) {
    var rec = S().getDone()[day.date] || {};
    if (!day.article) { el.innerHTML = '<div class="empty-state">今天沒有文章</div>'; return; }
    el.innerHTML =
      '<div class="card">' + articleHtml(day.article) +
        '<button class="btn block' + (rec.reading ? ' ghost' : '') + '" id="mark-reading">' +
          (rec.reading ? '✅ 已完成閱讀' : '我讀完文章、也朗讀過了 ✓') + '</button>' +
        '<p class="sub" style="margin-top:8px;">📌 讀完了嗎？等一下的測驗會考文章內容喔！</p>' +
      '</div>';
    bindSpeedToggle(el);
    el.querySelector('#mark-reading').addEventListener('click', function() {
      S().markDone(day.date, 'reading');
      window.SEApp.toast('閱讀完成！✨');
      renderDay(document.getElementById('view'), day.date, 'quiz');
    });
  }

  function renderDayQuiz(el, day) {
    var rec = S().getDone()[day.date] || {};
    el.innerHTML =
      '<div class="card" style="text-align:center;">' +
        '<h2 style="justify-content:center;">🎯 今日測驗</h2>' +
        '<p class="sub" style="line-height:1.9;">單字 ' + day.words.length + ' 題＋文法 ' +
          day.grammars.reduce(function(n, g) { return n + (g.quiz || []).length; }, 0) +
          ' 題＋閱讀 ' + (day.article ? day.article.questions.length : 0) + ' 題<br>' +
          '答錯的題目會自動加入錯題本 📌' +
          (rec.score ? '<br>上次成績：<b>' + esc(rec.score) + '</b>' : '') + '</p>' +
        '<button class="btn orange block" id="start-quiz">開始測驗 ▶</button>' +
      '</div>';
    el.querySelector('#start-quiz').addEventListener('click', function() {
      el.innerHTML = '<div class="loading">出題中…</div>';
      window.SEQuiz.buildDailyQuiz(day).then(function(qs) {
        window.SEQuiz.run(el, qs, { mode: 'daily', date: day.date });
      });
    });
  }

  // ══════════════ 分類庫 ══════════════
  function renderLibrary(el) {
    el.innerHTML =
      '<div class="card"><h2>📚 分類庫</h2><p class="sub">整個暑假的內容都在這裡，想單獨複習哪一類就點哪一類！</p></div>' +
      '<div class="hub-grid">' +
        '<div class="hub-card" data-go="#vocab"><div class="ic">📖</div><b>單字庫</b><div class="sub">8 週 336 字</div></div>' +
        '<div class="hub-card" data-go="#grammar"><div class="ic">✏️</div><b>文法</b><div class="sub">16 個重點</div></div>' +
        '<div class="hub-card" data-go="#reading"><div class="ic">📰</div><b>文章</b><div class="sub">每日一篇 · 56 篇</div></div>' +
        '<div class="hub-card" data-go="#writing"><div class="ic">📝</div><b>寫作練習</b><div class="sub">每週造樣造句</div></div>' +
        '<div class="hub-card" data-go="#wrong"><div class="ic">📌</div><b>錯題本</b><div class="sub">' + S().getWrong().length + ' 題待複習</div></div>' +
        '<div class="hub-card" data-go="#stats"><div class="ic">📈</div><b>學習統計</b><div class="sub">進度與正確率</div></div>' +
      '</div>';
    el.querySelectorAll('.hub-card').forEach(function(c) {
      c.addEventListener('click', function() { location.hash = c.getAttribute('data-go'); });
    });
  }

  function renderVocabLib(el) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    Promise.all([D().getAllVocab(), D().getPlan()]).then(function(res) {
      var weeks = res[0], plan = res[1];
      var html = '<div class="card"><h2>📖 單字庫</h2><div>' + speedToggleHtml() + '</div></div>';
      weeks.forEach(function(wk) {
        var info = (plan.weeks || []).find(function(x) { return x.week === wk.week; }) || {};
        var count = (wk.days || []).reduce(function(n, d) { return n + (d.words || []).length; }, 0);
        html += '<details class="week-acc"><summary>第 ' + wk.week + ' 週｜' + esc(info.theme || '') +
          '<span class="pill">' + count + ' 字</span></summary><div class="acc-body">' +
          (wk.days || []).map(function(d) {
            return '<p class="sub" style="margin-top:10px;">📅 ' + d.date.slice(5).replace('-', '/') + '</p>' +
              (d.words || []).map(wordCardHtml).join('');
          }).join('') +
          '</div></details>';
      });
      el.innerHTML = html;
      bindSpeedToggle(el);
    });
  }

  function renderGrammarLib(el) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    D().getGrammar().then(function(list) {
      el.innerHTML =
        '<div class="card"><h2>✏️ 文法重點（16 個）</h2>' +
          list.map(function(g) {
            return '<div class="list-row" data-go="#grammar/' + g.id + '">' +
              '<div><div class="t">' + esc(g.name) + '</div><div class="s">' + esc(g.pattern) + '</div></div>' +
              '<span class="pill">W' + g.week + '</span><span class="arrow">›</span></div>';
          }).join('') +
        '</div>';
      el.querySelectorAll('.list-row').forEach(function(r) {
        r.addEventListener('click', function() { location.hash = r.getAttribute('data-go'); });
      });
    });
  }

  function renderGrammarDetail(el, id) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    D().getGrammar().then(function(list) {
      var g = list.find(function(x) { return x.id === id; });
      if (!g) { el.innerHTML = '<div class="empty-state">找不到這個文法</div>'; return; }
      el.innerHTML =
        '<a class="btn ghost" style="margin-bottom:12px;" href="#grammar">← 文法列表</a>' +
        grammarCardHtml(g) +
        '<div class="card"><h2>🎯 小試身手</h2><div id="g-quiz"></div>' +
        '<button class="btn block" id="g-quiz-start">練習 ' + (g.quiz || []).length + ' 題 ▶</button></div>';
      el.querySelector('#g-quiz-start').addEventListener('click', function() {
        var box = el.querySelector('#g-quiz');
        var qs = (g.quiz || []).map(function(_, i) {
          return { k: 'g:' + g.id + ':' + i, t: 'grammar', q: g.quiz[i].q,
                   options: window.SEQuiz.shuffle(g.quiz[i].options.slice()), answer: g.quiz[i].answer,
                   explain: '文法重點：' + g.name + '｜' + g.pattern };
        });
        this.style.display = 'none';
        window.SEQuiz.run(box, qs, { mode: 'daily' });
      });
    });
  }

  function renderReadingLib(el) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    Promise.all([D().getAllReading(), D().getPlan()]).then(function(res) {
      var weeks = res[0], plan = res[1];
      var html = '<div class="card"><h2>📰 文章庫（每日一篇）</h2></div>';
      weeks.forEach(function(wk) {
        var info = (plan.weeks || []).find(function(x) { return x.week === wk.week; }) || {};
        html += '<details class="week-acc"' + '><summary>第 ' + wk.week + ' 週｜' + esc(info.theme || '') +
          '<span class="pill">' + (wk.articles || []).length + ' 篇</span></summary><div class="acc-body">' +
          (wk.articles || []).map(function(a) {
            return '<div class="list-row" data-go="#reading/' + a.id + '">' +
              '<div><div class="t">' + esc(a.title) + '</div><div class="s">' + a.date.slice(5).replace('-', '/') + '</div></div>' +
              '<span class="arrow">›</span></div>';
          }).join('') + '</div></details>';
      });
      el.innerHTML = html;
      el.querySelectorAll('.list-row').forEach(function(r) {
        r.addEventListener('click', function() { location.hash = r.getAttribute('data-go'); });
      });
    });
  }

  function renderReadingDetail(el, id) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    D().findArticle(id).then(function(a) {
      if (!a) { el.innerHTML = '<div class="empty-state">找不到這篇文章</div>'; return; }
      el.innerHTML =
        '<a class="btn ghost" style="margin-bottom:12px;" href="#reading">← 文章列表</a>' +
        '<div class="card">' + articleHtml(a, true) + '</div>' +
        '<div class="card"><h2>🎯 閱讀測驗</h2><div id="r-quiz"></div>' +
        '<button class="btn block" id="r-quiz-start">作答 ' + a.questions.length + ' 題 ▶</button></div>';
      bindSpeedToggle(el);
      el.querySelector('#r-quiz-start').addEventListener('click', function() {
        var qs = a.questions.map(function(_, i) {
          var item = a.questions[i];
          return { k: 'r:' + a.id + ':' + i, t: 'reading', q: item.q,
                   options: window.SEQuiz.shuffle(item.options.slice()), answer: item.answer,
                   explain: '出自文章：' + a.title };
        });
        this.style.display = 'none';
        window.SEQuiz.run(el.querySelector('#r-quiz'), qs, { mode: 'daily' });
      });
    });
  }

  // ══════════════ 寫作練習 ══════════════
  function renderWritingLib(el) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    Promise.all([D().getWriting(), D().getPlan()]).then(function(res) {
      var list = res[0], plan = res[1];
      el.innerHTML =
        '<div class="card"><h2>📝 每週寫作練習</h2>' +
        '<p class="sub">每週 3 個重點單字＋2 個文法，照著例句「造樣造句」。寫完再點開參考答案對照！</p>' +
          list.map(function(w) {
            var info = (plan.weeks || []).find(function(x) { return x.week === w.week; }) || {};
            return '<div class="list-row" data-go="#writing/' + w.week + '">' +
              '<div><div class="t">第 ' + w.week + ' 週寫作</div><div class="s">' + esc(info.theme || '') + '</div></div>' +
              '<span class="arrow">›</span></div>';
          }).join('') +
        '</div>';
      el.querySelectorAll('.list-row').forEach(function(r) {
        r.addEventListener('click', function() { location.hash = r.getAttribute('data-go'); });
      });
    });
  }

  function renderWritingWeek(el, week, embedded) {
    el.innerHTML = '<div class="loading">載入中…</div>';
    D().getWriting().then(function(list) {
      var w = list.find(function(x) { return x.week === +week; });
      if (!w) { el.innerHTML = '<div class="empty-state">找不到這週的寫作練習</div>'; return; }
      var saved = S().getWriting();
      var html =
        (embedded ? '' : '<a class="btn ghost" style="margin-bottom:12px;" href="#writing">← 寫作列表</a>') +
        '<div class="card"><h2>📝 第 ' + w.week + ' 週寫作練習</h2>' +
        '<p class="sub">照著例句的句型，換成自己的內容造一個句子。寫完點「看參考答案」自我核對！</p>' +
        w.items.map(function(it, i) {
          var wid = 'w' + w.week + '-' + i;
          return '<div class="writing-item">' +
            '<div><span class="pill' + (it.type === 'grammar' ? ' orange' : '') + '">' +
              (it.type === 'grammar' ? '文法' : '重點單字') + '</span> <b style="font-size:1.05rem;">' + esc(it.target) + '</b></div>' +
            '<div class="writing-model">📌 例句：' + esc(it.model_en) + ' ' + ttsBtn(it.model_en) +
              '<span class="zh sub" style="display:block;">' + esc(it.model_zh) + '</span></div>' +
            '<div class="sub">' + esc(it.prompt_zh) + '</div>' +
            '<textarea class="writing-input" data-wid="' + wid + '" placeholder="在這裡寫下你的句子…">' + esc(saved[wid] || '') + '</textarea>' +
            '<details class="ref-box"><summary class="sub" style="cursor:pointer;">👀 看參考答案</summary>' +
              '<div class="refs">' + it.refs.map(function(r) { return '✔ ' + esc(r); }).join('<br>') + '</div></details>' +
          '</div>';
        }).join('') +
        '<button class="btn block" id="save-writing">💾 儲存我的句子</button>' +
        '</div>';
      el.innerHTML = html;
      el.querySelector('#save-writing').addEventListener('click', function() {
        el.querySelectorAll('.writing-input').forEach(function(t) {
          S().saveWriting(t.getAttribute('data-wid'), t.value.trim());
        });
        window.SEApp.toast('已儲存！登入 Google 會自動備份 ☁️');
      });
    });
  }

  // ══════════════ 錯題本 ══════════════
  function renderWrong(el) {
    var list = S().getWrong().slice().sort(function(a, b) { return b.ts - a.ts; });
    if (!list.length) {
      el.innerHTML = '<div class="empty-state"><div class="big">🎉</div>錯題本是空的！<br>表示你都答對了，繼續保持！<br><br><a class="btn" href="#calendar">回行事曆</a></div>';
      return;
    }
    var typeName = { vocab: '單字', grammar: '文法', reading: '閱讀' };
    el.innerHTML =
      '<div class="card">' +
        '<h2>📌 錯題本（' + list.length + ' 題）</h2>' +
        '<p class="sub">答錯的題目都在這裡。「隨機重練」會打亂順序、重洗選項，答對就自動移除！</p>' +
        '<button class="btn orange block" id="wrong-practice">🎲 隨機重練（最多 10 題）</button>' +
      '</div>' +
      '<div class="card">' +
        list.map(function(w) {
          return '<div class="wrong-row">' +
            '<span class="pill' + (w.t === 'grammar' ? ' orange' : w.t === 'reading' ? ' green' : '') + '">' + (typeName[w.t] || w.t) + '</span>' +
            '<div class="info"><div class="q">' + esc(w.q || w.k) + '</div>' +
            '<div class="meta">答錯 ' + (w.wrongCount || 1) + ' 次</div></div>' +
          '</div>';
        }).join('') +
      '</div>';
    el.querySelector('#wrong-practice').addEventListener('click', startWrongQuiz);
  }

  function startWrongQuiz() {
    var el = document.getElementById('view');
    el.innerHTML = '<div class="loading">出題中…（重洗選項、隨機排序）</div>';
    window.SEQuiz.buildWrongQuiz(10).then(function(qs) {
      window.SEQuiz.run(el, qs, { mode: 'wrong', onAgain: startWrongQuiz });
    });
  }

  // ══════════════ 統計 ══════════════
  function renderStats(el) {
    var done = S().getDone();
    var stats = S().getStats();
    var doneDays = 0, partialDays = 0;
    Object.keys(done).forEach(function(d) {
      if (S().isDayComplete(done[d])) doneDays++;
      else partialDays++;
    });
    var acc = stats.answered ? Math.round(stats.correct / stats.answered * 100) : 0;
    var user = window.SEAuth && window.SEAuth.getUser();

    el.innerHTML =
      '<div class="card"><h2>📈 學習統計</h2>' +
        '<p class="sub">' + (user ? '☁️ 已登入 ' + esc(user.displayName || user.email) + '，紀錄會自動備份到雲端。'
          : '尚未登入。點右上角「Google 登入同步」，換手機、換電腦紀錄都不會不見！') + '</p></div>' +
      '<div class="stat-grid">' +
        '<div class="stat-tile"><div class="num">' + doneDays + '</div><div class="lbl">完成天數 / 56</div></div>' +
        '<div class="stat-tile"><div class="num">' + partialDays + '</div><div class="lbl">進行中天數</div></div>' +
        '<div class="stat-tile"><div class="num">' + stats.quizzes + '</div><div class="lbl">完成測驗次數</div></div>' +
        '<div class="stat-tile"><div class="num">' + stats.answered + '</div><div class="lbl">累計作答題數</div></div>' +
        '<div class="stat-tile"><div class="num">' + acc + '%</div><div class="lbl">整體正確率</div></div>' +
        '<div class="stat-tile"><div class="num">' + S().getWrong().length + '</div><div class="lbl">錯題本待消滅</div></div>' +
      '</div>' +
      '<div class="card" style="margin-top:14px;"><h2>🗓️ 各日完成度</h2>' +
        (Object.keys(done).length
          ? Object.keys(done).sort().map(function(d) {
              var r = done[d];
              return '<div class="list-row" data-go="#day/' + d + '"><div><div class="t">' + d.replace(/-/g, '/') + '</div>' +
                '<div class="s">' +
                (r.vocab ? '單字✓ ' : '') + (r.grammar ? '文法✓ ' : '') +
                (r.reading ? '閱讀✓ ' : '') + (r.quiz ? '測驗✓' + (r.score ? '（' + esc(r.score) + '）' : '') : '') +
                '</div></div><span class="arrow">›</span></div>';
            }).join('')
          : '<p class="sub">還沒有紀錄，快去完成第一天吧！</p>') +
      '</div>';
    el.querySelectorAll('.list-row[data-go]').forEach(function(r) {
      r.addEventListener('click', function() { location.hash = r.getAttribute('data-go'); });
    });
  }

  return {
    renderCalendar: renderCalendar, renderDay: renderDay,
    renderLibrary: renderLibrary, renderVocabLib: renderVocabLib,
    renderGrammarLib: renderGrammarLib, renderGrammarDetail: renderGrammarDetail,
    renderReadingLib: renderReadingLib, renderReadingDetail: renderReadingDetail,
    renderWritingLib: renderWritingLib, renderWritingWeek: renderWritingWeek,
    renderWrong: renderWrong, renderStats: renderStats
  };
})();
