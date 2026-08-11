// ============================================================
// SEAudio — 發音升級 MP3 引擎
// 契約：docs/AUDIO_CONTRACT.md §2
// ES5、IIFE、掛 window.SEAudio。單一 HTMLAudioElement，同時只播一個。
// 永不 throw、永不卡死；MP3 失敗或 src()===null → 退到 SETts.speak 備援。
// ============================================================
(function() {
  'use strict';

  // ────── 內部狀態 ──────
  var manifest = null;            // data/audio-manifest.json 的內容
  var readyResolve = null;
  var readyPromise = new Promise(function(resolve) { readyResolve = resolve; });
  var initStarted = false;        // init() 只跑一次

  var currentAudio = null;        // 目前正在播的 HTMLAudioElement
  var currentBtn = null;          // 我方追蹤的 .speaking 按鈕
  var playingFlag = false;        // isPlaying() 用

  // 兩個單調遞增的「世代號」：
  //  - playingToken：每個 _doPlay 取得一個；新 play/playSequence 會 +1，使舊的失效
  //  - sequenceToken：playSequence 用；新 play/playSequence 會 +1，使舊的序列中斷
  var playingToken = 0;
  var sequenceToken = 0;
  var preloadCache = [];          // 預抓保留，避免被 GC

  // ────── 小工具 ──────
  function noop() {}

  function safeAddBtn(btn) {
    if (!btn || !btn.classList) return;
    try {
      if (currentBtn && currentBtn !== btn) safeRemoveBtn(currentBtn);
      currentBtn = btn;
      btn.classList.add('speaking');
    } catch (e) {}
  }
  function safeRemoveBtn(btn) {
    if (!btn || !btn.classList) return;
    try { btn.classList.remove('speaking'); } catch (e) {}
    if (currentBtn === btn) currentBtn = null;
  }

  function currentSpeed() {
    var s = (window.SEStore && window.SEStore.getSettings)
      ? window.SEStore.getSettings() : {};
    return s.ttsNormal ? 'n' : 's';
  }

  function fallbackRate(speed) {
    return speed === 's' ? 0.55 : 0.8;
  }

  // ────── src()：依 manifest 查路徑 ──────
  function src(scope, id, speed, idx) {
    if (!manifest || !scope || !id) return null;
    var section = manifest[scope];
    if (!section) return null;

    if (scope === 'grammar') {
      var arr = section[id];
      if (!arr || !arr[idx]) return null;
      var gItem = arr[idx];
      return (gItem && gItem[speed]) || null;
    }
    if (scope === 'reading') {
      var rd = section[id];
      if (!rd || !rd.audio) return null;
      return rd.audio[idx] || null;
    }
    // word / ex / writing
    var item = section[id];
    if (!item) return null;
    return item[speed] || null;
  }

  // ────── 內部：停 audio（不動 SETts） ──────
  function stopAudioOnly() {
    if (currentAudio) {
      var a = currentAudio;
      try { a.onended = null; } catch (e) {}
      try { a.onerror = null; } catch (e) {}
      try { a.onloadstart = null; } catch (e) {}
      try { a.pause(); } catch (e) {}
      try { a.removeAttribute('src'); a.load(); } catch (e) {}
      currentAudio = null;
    }
    if (currentBtn) { safeRemoveBtn(currentBtn); }
  }

  // ────── 內部：備援（SETts.speak）並等待結束 ──────
  function doFallback(text, btn, speed) {
    return new Promise(function(resolve) {
      try {
        if (window.SETts && typeof window.SETts.speak === 'function' && text) {
          window.SETts.speak(text, btn || null, fallbackRate(speed));
        }
      } catch (e) {}
      waitSynth(resolve);
    });
  }

  function waitSynth(resolve) {
    var synth = window.speechSynthesis;
    if (!synth) { resolve(); return; }
    var start = Date.now();
    var iv = setInterval(function() {
      // playingFlag 會被 stop() 設 false；synth.speaking 反映實際朗讀狀態
      var talking = synth.speaking || synth.pending;
      if (!playingFlag || !talking) {
        clearInterval(iv);
        resolve();
        return;
      }
      // 保險：備援最多 30 秒
      if (Date.now() - start > 30000) { clearInterval(iv); resolve(); }
    }, 80);
  }

  // ────── 全域 reset：停 audio + SETts + 失效所有 token ──────
  function resetAll() {
    sequenceToken++;
    playingToken++;
    playingFlag = false;
    stopAudioOnly();
    try {
      if (window.SETts && typeof window.SETts.stop === 'function') {
        window.SETts.stop();
      }
    } catch (e) {}
  }

  // ────── 核心播放（內部），對外由 play / playSequence 包裝 ──────
  function _doPlay(o) {
    var scope = o.scope;
    var id = o.id;
    var idx = (typeof o.idx === 'number') ? o.idx : null;
    var speed = o.speed || currentSpeed();
    var fb = o.fallbackText || '';
    var btn = o.btnEl || null;
    var onstart = (typeof o.onstart === 'function') ? o.onstart : noop;
    var onend = (typeof o.onend === 'function') ? o.onend : noop;
    var myToken = ++playingToken;

    return new Promise(function(resolve) {
      playingFlag = true;

      function isStale() { return myToken !== playingToken; }

      function finishSuccess() {
        if (isStale()) { resolve(); return; }
        safeRemoveBtn(btn);
        playingFlag = false;
        try { onend(); } catch (e) {}
        resolve();
      }

      function finishFallback() {
        if (isStale()) { resolve(); return; }
        doFallback(fb, btn, speed).then(function() {
          if (isStale()) { resolve(); return; }
          safeRemoveBtn(btn);
          playingFlag = false;
          try { onend(); } catch (e) {}
          resolve();
        });
      }

      // 先查 src
      var url = src(scope, id, speed, idx);
      if (!url) {
        safeAddBtn(btn);
        try { onstart(); } catch (e) {}
        finishFallback();
        return;
      }

      var audio = new Audio();
      currentAudio = audio;
      audio.preload = 'auto';

      var cleanedUp = false;
      function cleanup() {
        if (cleanedUp) return;
        cleanedUp = true;
        try { audio.onended = null; } catch (e) {}
        try { audio.onerror = null; } catch (e) {}
        try { audio.onloadstart = null; } catch (e) {}
        if (currentAudio === audio) currentAudio = null;
        try { audio.pause(); } catch (e) {}
        try { audio.removeAttribute('src'); audio.load(); } catch (e) {}
      }

      audio.onended = function() {
        cleanup();
        finishSuccess();
      };
      audio.onerror = function() {
        cleanup();
        if (isStale()) { resolve(); return; }
        safeAddBtn(btn);
        try { onstart(); } catch (e) {}
        finishFallback();
      };

      try {
        audio.src = url;
        safeAddBtn(btn);
        var p = audio.play();
        if (p && typeof p.then === 'function') {
          p.then(function() {
            if (isStale()) return;
            try { onstart(); } catch (e) {}
          }).catch(function() {
            // play() 被拒絕（autoplay 阻擋、資源 404 等）→ 走 onerror 路徑
            try { if (audio.onerror) audio.onerror(); } catch (e) { finishFallback(); }
          });
        } else {
          // 沒 Promise：退到 onloadstart
          audio.onloadstart = function() {
            if (isStale()) return;
            try { onstart(); } catch (e) {}
          };
        }
      } catch (e) {
        // 同步丟例外 → 備援
        cleanup();
        if (isStale()) { resolve(); return; }
        safeAddBtn(btn);
        try { onstart(); } catch (e) {}
        finishFallback();
      }
    });
  }

  // ────── 對外：play() ──────
  function play(opts) {
    var o = opts || {};
    resetAll();
    return _doPlay(o);
  }

  // ────── 對外：stop() ──────
  function stop() {
    resetAll();
  }

  // ────── 對外：preload() ──────
  function preload(scope, id, speed, idx) {
    var url = src(scope, id, speed, idx);
    if (!url) return;
    try {
      var a = new Audio();
      a.preload = 'auto';
      try { a.src = url; } catch (e) {}
      preloadCache.push(a);
      // 避免無上限累積
      if (preloadCache.length > 32) preloadCache.shift();
    } catch (e) {}
  }

  // ────── 對外：isPlaying() ──────
  function isPlaying() {
    if (playingFlag) return true;
    var synth = window.speechSynthesis;
    if (synth && (synth.speaking || synth.pending)) return true;
    return false;
  }

  // ────── 對外：playSequence() ──────
  function playSequence(items, opts) {
    items = items || [];
    opts = opts || {};
    var onItem = (typeof opts.onItem === 'function') ? opts.onItem : noop;
    var onDone = (typeof opts.onDone === 'function') ? opts.onDone : noop;
    var seqSpeed = opts.speed || null;

    // 開始前先停舊的，並取得自己的 sequence token
    resetAll();
    var mySeqToken = ++sequenceToken;

    function step(i) {
      if (mySeqToken !== sequenceToken) return Promise.resolve();
      if (i >= items.length) {
        try { onDone(); } catch (e) {}
        return Promise.resolve();
      }
      var it = items[i];
      var itIdx = (typeof it.idx === 'number') ? it.idx : null;

      // 預抓下一個
      if (i + 1 < items.length) {
        var nx = items[i + 1];
        var nxIdx = (typeof nx.idx === 'number') ? nx.idx : null;
        try { preload(nx.scope, nx.id, seqSpeed, nxIdx); } catch (e) {}
      }

      try { onItem(i); } catch (e) {}

      return _doPlay({
        scope: it.scope,
        id: it.id,
        idx: itIdx,
        speed: seqSpeed || undefined,
        fallbackText: it.fallbackText || '',
        btnEl: null
      }).then(function() { return step(i + 1); });
    }

    if (items.length === 0) {
      try { onDone(); } catch (e) {}
      return { stop: function() { resetAll(); } };
    }

    step(0);

    return {
      stop: function() {
        if (mySeqToken !== sequenceToken) return;
        resetAll();
      }
    };
  }

  // ────── 對外：init() ──────
  function init() {
    if (initStarted) return readyPromise;
    initStarted = true;

    var url = 'data/audio-manifest.json';
    if (typeof window.APP_VERSION !== 'undefined' && window.APP_VERSION !== null) {
      url += '?v=' + encodeURIComponent(window.APP_VERSION);
    }

    function fallbackResolve() {
      manifest = null;
      try { readyResolve(null); } catch (e) {}
    }

    if (typeof window.fetch !== 'function') {
      fallbackResolve();
      return readyPromise;
    }

    try {
      window.fetch(url).then(function(r) {
        if (!r || !r.ok) throw new Error('http ' + (r && r.status));
        return r.json();
      }).then(function(m) {
        manifest = (m && typeof m === 'object') ? m : null;
        try { readyResolve(manifest); } catch (e) {}
      }).catch(function() {
        fallbackResolve();
      });
    } catch (e) {
      fallbackResolve();
    }

    return readyPromise;
  }

  // ────── 掛載 ──────
  window.SEAudio = {
    ready: readyPromise,
    init: init,
    currentSpeed: currentSpeed,
    src: src,
    play: play,
    stop: stop,
    preload: preload,
    isPlaying: isPlaying,
    playSequence: playSequence
  };
})();