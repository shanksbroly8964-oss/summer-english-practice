// ============================================================
// SEReadingFollow — 逐句跟讀（消費 SEAudio）
// 對應 docs/AUDIO_CONTRACT.md §4
//
// 公開 API：
//   render(containerEl, articleId)
//   stop()
//
// 行為：
//   - 句子與音檔一律來自 data/audio-manifest.json 的 reading[articleId]
//     （不自行重切句；index 對齊 audio）
//   - 用 SEAudio.playSequence(items, {speed:'n', onItem, onDone}) 串接
//   - 高亮：.rf-active（外觀由 MAIN 提供）；捲動用 scrollIntoView
//   - 點句 / 上一句 / 下一句 都會重建 playSequence 從指定 idx 起播
//   - 暫停：停 SEAudio，保留 currentIdx；再按從該句續播
//   - stop()：停 SEAudio 並移除所有 .rf-active
// ============================================================
window.SEReadingFollow = (function() {
  'use strict';

  var APP_VERSION = (typeof window.APP_VERSION === 'string') ? window.APP_VERSION : '';
  var manifestCache = null;
  var manifestLoading = null;

  // ---- manifest 取得 ----
  function fetchManifest() {
    if (manifestCache) return Promise.resolve(manifestCache);
    if (manifestLoading) return manifestLoading;
    if (typeof window.fetch !== 'function') return Promise.resolve(null);
    var url = 'data/audio-manifest.json'
            + (APP_VERSION ? '?v=' + encodeURIComponent(APP_VERSION) : '');
    manifestLoading = window.fetch(url, { cache: 'no-cache' })
      .then(function(r) {
        if (!r || !r.ok) return null;
        return r.json();
      })
      .then(function(j) {
        manifestCache = j;
        return j;
      })
      .catch(function() { return null; });
    return manifestLoading;
  }

  function ensureManifest() {
    if (manifestCache) return Promise.resolve(manifestCache);
    var ready = (window.SEAudio && window.SEAudio.ready) ? window.SEAudio.ready : null;
    var p = ready ? Promise.resolve(ready).then(fetchManifest) : fetchManifest();
    return p;
  }

  // ---- DOM 工具 ----
  function clearActive(root) {
    var spans = root.querySelectorAll('.rf-active');
    for (var i = 0; i < spans.length; i++) spans[i].classList.remove('rf-active');
  }

  function highlight(root, idx) {
    var span = root.querySelector('.rf-sent[data-idx="' + idx + '"]');
    if (!span) return;
    clearActive(root);
    span.classList.add('rf-active');
    if (typeof span.scrollIntoView === 'function') {
      try { span.scrollIntoView({ block: 'center' }); } catch (e) { /* old browsers */ }
    }
  }

  function btnStyle() {
    // 最小 inline style：讓控制鈕能點；高亮外觀完全交給 .rf-active（MAIN 提供）
    return 'margin:2px;padding:6px 10px;border:1px solid #888;background:#f5f5f5;'
         + 'border-radius:4px;cursor:pointer;font-size:14px;line-height:1.2;';
  }

  function makeBtn(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'rf-btn ' + (cls || '');
    b.textContent = label;
    b.setAttribute('style', btnStyle());
    return b;
  }

  function setPlayLabel(btn, playing) {
    btn.textContent = playing ? '⏸ 暫停' : '▶ 逐句播放';
  }

  // ---- items ----
  function buildItems(sentences, articleId, fromIdx) {
    var items = [];
    var n = sentences.length;
    for (var i = fromIdx; i < n; i++) {
      items.push({
        scope: 'reading',
        id: articleId,
        idx: i,
        fallbackText: sentences[i] || ''
      });
    }
    return items;
  }

  // ---- 對外：render ----
  function render(containerEl, articleId) {
    if (!containerEl || !articleId) return;

    ensureManifest().then(function(manifest) {
      if (!manifest || !manifest.reading || !manifest.reading[articleId]) {
        containerEl.innerHTML = '';
        var p = document.createElement('p');
        p.className = 'rf-empty';
        p.textContent = '此篇尚無發音資料。';
        containerEl.appendChild(p);
        return;
      }

      var reading = manifest.reading[articleId];
      var sentences = reading.sentences || [];
      var audio = reading.audio || [];
      var n = sentences.length;

      // 避免重複渲染：清乾淨再來
      containerEl.innerHTML = '';

      var root = document.createElement('div');
      root.className = 'rf-root';
      containerEl.appendChild(root);

      // (a) 控制鈕列
      var ctrl = document.createElement('div');
      ctrl.className = 'rf-controls';
      var playBtn = makeBtn('▶ 逐句播放', 'rf-play');
      var prevBtn = makeBtn('⟸ 上一句', 'rf-prev');
      var nextBtn = makeBtn('下一句 ⟹', 'rf-next');
      var stopBtn = makeBtn('⏹ 停止', 'rf-stop');
      ctrl.appendChild(playBtn);
      ctrl.appendChild(prevBtn);
      ctrl.appendChild(nextBtn);
      ctrl.appendChild(stopBtn);
      root.appendChild(ctrl);

      // (b) 句子區
      var sentBox = document.createElement('div');
      sentBox.className = 'rf-sentences';
      for (var i = 0; i < n; i++) {
        var s = document.createElement('span');
        s.className = 'rf-sent' + (i === 0 ? ' rf-title' : '');
        s.setAttribute('data-idx', String(i));
        // 句尾空白（按契約）
        s.textContent = (sentences[i] || '') + ' ';
        sentBox.appendChild(s);
      }
      root.appendChild(sentBox);

      // ---- 狀態 ----
      var st = {
        currentIdx: 0,
        isPlaying: false,
        controller: null
      };

      function clampIdx(idx) {
        if (idx < 0) return 0;
        if (idx >= n) return n - 1;
        return idx;
      }

      function stopSeq() {
        if (st.controller && typeof st.controller.stop === 'function') {
          try { st.controller.stop(); } catch (e) { /* swallow */ }
        }
        st.controller = null;
        if (window.SEAudio && typeof window.SEAudio.stop === 'function') {
          try { window.SEAudio.stop(); } catch (e) { /* swallow */ }
        }
      }

      function playFrom(idx) {
        if (n <= 0) return;
        idx = clampIdx(idx);
        st.currentIdx = idx;
        stopSeq();

        var items = buildItems(sentences, articleId, idx);
        if (!items.length) {
          st.isPlaying = false;
          setPlayLabel(playBtn, false);
          return;
        }

        if (window.SEAudio && typeof window.SEAudio.playSequence === 'function') {
          try {
            st.controller = window.SEAudio.playSequence(items, {
              speed: 'n',
              onItem: function(j) {
                // j = 在 items 內的索引；實際句 idx = 起始 idx + j
                st.currentIdx = clampIdx(idx + j);
                highlight(root, st.currentIdx);
              },
              onDone: function() {
                st.isPlaying = false;
                st.controller = null;
                setPlayLabel(playBtn, false);
                // 保留最後一句高亮（不 clearActive）
              }
            });
            st.isPlaying = true;
            setPlayLabel(playBtn, true);
          } catch (e) {
            // SEAudio 丟錯也要降級到 SETts
            fallbackSingle(idx);
          }
        } else {
          fallbackSingle(idx);
        }
      }

      function fallbackSingle(idx) {
        if (window.SETts && typeof window.SETts.speak === 'function') {
          try { window.SETts.speak(sentences[idx] || ''); } catch (e) { /* swallow */ }
        }
        highlight(root, idx);
        st.isPlaying = false;
        setPlayLabel(playBtn, false);
      }

      function pause() {
        stopSeq();
        st.isPlaying = false;
        setPlayLabel(playBtn, false);
        // 保留 currentIdx（不 clearActive），再按繼續從該句起
      }

      function hardStop() {
        pause();
        clearActive(root);
      }

      // 控制鈕事件
      playBtn.addEventListener('click', function() {
        if (st.isPlaying) { pause(); return; }
        playFrom(st.currentIdx);
      });
      prevBtn.addEventListener('click', function() {
        playFrom(st.currentIdx - 1);
      });
      nextBtn.addEventListener('click', function() {
        playFrom(st.currentIdx + 1);
      });
      stopBtn.addEventListener('click', function() {
        hardStop();
      });

      // 點某句 → 從該句起播（事件代理）
      sentBox.addEventListener('click', function(e) {
        var t = e.target;
        while (t && t !== sentBox) {
          if (t.classList && t.classList.contains('rf-sent')) break;
          t = t.parentNode;
        }
        if (!t || t === sentBox) return;
        var raw = t.getAttribute('data-idx');
        var k = raw ? parseInt(raw, 10) : 0;
        if (!isNaN(k)) playFrom(k);
      });

      // 對外暴露（給 MAIN 偵錯用，可不接）
      root.__rf_state = st;
    });
  }

  // ---- 對外：stop ----
  function stop() {
    if (window.SEAudio && typeof window.SEAudio.stop === 'function') {
      try { window.SEAudio.stop(); } catch (e) { /* swallow */ }
    }
    var nodes = document.querySelectorAll('.rf-active');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('rf-active');
  }

  return { render: render, stop: stop };
})();
