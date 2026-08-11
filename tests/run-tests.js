// ============================================================
// A4 測試 — pure Node, no browser, no external deps
// 跑法：node tests/run-tests.js
// 退出碼：0 = 全 PASS 或 WARN； 1 = 任一 FAIL
// 範圍：data/audio-manifest.json、js/audio.js、js/listening-quiz.js、js/reading-follow.js
// ============================================================
'use strict';

var fs      = require('fs');
var path    = require('path');
var vm      = require('vm');

var ROOT       = path.resolve(__dirname, '..');
var MANIFEST   = path.join(ROOT, 'data', 'audio-manifest.json');
var REPORT_OUT = path.join(ROOT, 'deliverables', 'A4_TESTS.md');
var DONE_OUT   = path.join(ROOT, 'deliverables', 'A4.DONE');

var results = [];
var fatal   = false;

function record(name, status, message, detail) {
  results.push({ name: name, status: status, message: message || '', detail: detail || '' });
  var tag = status === 'PASS'    ? 'PASS'
          : status === 'WARN'    ? 'WARN'
          : status === 'PENDING' ? 'PEND'
          : status === 'INFO'    ? 'INFO'
          :                        'FAIL';
  console.log('[' + tag + '] ' + name + (message ? ' — ' + message : ''));
  if (status === 'FAIL') fatal = true;
}

// ───────────────────────── helpers ─────────────────────────
function safeReadJSON(p) {
  try {
    var raw = fs.readFileSync(p, 'utf8');
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, err: e.message };
  }
}

// 對 vm 載入的檔做語法檢查（等同 node --check）
function syntaxCheck(label, filePath) {
  if (!fs.existsSync(filePath)) {
    record(label, 'PENDING', '檔案不存在：' + path.relative(ROOT, filePath));
    return false;
  }
  try {
    var src = fs.readFileSync(filePath, 'utf8');
    // 用 new vm.Script 包整檔，當 compile 失敗就當成 syntax error
    new vm.Script(src, { filename: filePath });
    record(label, 'PASS', 'syntax OK (' + src.length + ' bytes)');
    return true;
  } catch (e) {
    record(label, 'FAIL', 'syntax error: ' + e.message);
    return false;
  }
}

// 用 vm 載入一份 js；提供最小的 window/document/fetch/SEStore/SETts/Audio stub
// 並回傳 sandbox 供測試後讀取記錄
function loadInSandbox(filePath, extraStubs) {
  if (!fs.existsSync(filePath)) return null;
  var src = fs.readFileSync(filePath, 'utf8');

  var calls = { SETtsSpeak: [], SETtsStop: 0, fetch: 0, audioInstances: 0 };
  var listenerHandlers = [];

  // 假 Audio class：建構就把 onended 立刻 queue 起來（promise resolve 用）
  function FakeAudio() {
    calls.audioInstances++;
    this.src = '';
    this.currentTime = 0;
    this.paused = true;
    this.ended = false;
    this.error = false;
    this._listeners = {};
    var self = this;
    listenerHandlers.push(function(trigger) {
      if (self._listeners[trigger]) self._listeners[trigger]({ type: trigger, target: self });
    });
  }
  FakeAudio.prototype.play = function () { this.paused = false; return Promise.resolve(); };
  FakeAudio.prototype.pause = function () { this.paused = true; };
  FakeAudio.prototype.load = function () {};
  FakeAudio.prototype.addEventListener = function (ev, fn) {
    this._listeners[ev] = (this._listeners[ev] || []).concat ? null : fn; // simple
    this._listeners[ev] = fn;
  };
  FakeAudio.prototype.removeEventListener = function () {};
  Object.defineProperty(FakeAudio.prototype, 'onended',  { get: function () { return this._listeners.onended || null; },
                                                            set: function (fn) { this._listeners.onended = fn; } });
  Object.defineProperty(FakeAudio.prototype, 'onerror',  { get: function () { return this._listeners.onerror || null; },
                                                            set: function (fn) { this._listeners.onerror = fn; } });
  Object.defineProperty(FakeAudio.prototype, 'oncanplay',{ get: function () { return this._listeners.oncanplay || null; },
                                                            set: function (fn) { this._listeners.oncanplay = fn; } });

  // 假 SETts
  var SETts = {
    speak: function (text, btn, rate) { calls.SETtsSpeak.push({ text: text, rate: rate, hasBtn: !!btn }); },
    stop:  function () { calls.SETtsStop++; },
    RATES: { slow: 0.55, normal: 0.8 }
  };
  // 假 SEStore
  var SEStore = {
    getSettings: function () { return (extraStubs && extraStubs.settings) || {}; },
    setSetting:  function () {}
  };
  // 假 fetch
  var fetchedUrl = null;
  var fetchImpl = function (url) {
    calls.fetch++;
    fetchedUrl = url;
    return Promise.resolve({
      ok: true,
      status: 200,
      json: function () { return Promise.resolve(extraStubs.manifest || {}); },
      text: function () { return Promise.resolve(JSON.stringify(extraStubs.manifest || {})); }
    });
  };

  // 最小 document stub
  var documentStub = {
    addEventListener: function () {},
    createElement: function (tag) {
      if (tag === 'audio') return new FakeAudio();
      return { style: {}, classList: { add: function(){}, remove: function(){} }, setAttribute: function(){}, appendChild: function(){}, addEventListener: function(){} };
    },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    body: { appendChild: function () {} }
  };

  var sandbox = {
    window: {},
    document: documentStub,
    fetch: fetchImpl,
    Audio: FakeAudio,
    Promise: Promise,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    console: console,
    Date: Date,
    Math: Math,
    Object: Object,
    Array: Array,
    JSON: JSON,
    Number: Number,
    String: String,
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    setImmediate: setImmediate,
    process: process,
    __sandbox_calls: calls,
    __fetched_url: function () { return fetchedUrl; }
  };
  sandbox.window.SEStore = SEStore;
  sandbox.window.SETts   = SETts;
  sandbox.window.fetch   = fetchImpl;
  sandbox.window.JSON    = JSON;
  sandbox.window.Promise = Promise;
  sandbox.window.console = console;
  sandbox.window.Promise = Promise;
  sandbox.window.setTimeout = setTimeout;
  sandbox.window.clearTimeout = clearTimeout;
  sandbox.window.fetch = fetchImpl;
  // 預載 SEStore/SETts（audio.js 內可能直接用 window.SEStore，這樣保險）
  sandbox.window.SEAudio = undefined;

  try {
    vm.createContext(sandbox);
    var script = new vm.Script(src, { filename: filePath });
    script.runInContext(sandbox);
    return { ok: true, sandbox: sandbox, calls: calls };
  } catch (e) {
    return { ok: false, err: e.message, stack: e.stack };
  }
}

// ───────────────────────── SECTION 1: manifest schema ─────────────────────────
function section1_manifestSchema() {
  console.log('\n—— SECTION 1: data/audio-manifest.json schema ——');
  var r = safeReadJSON(MANIFEST);
  if (!r.ok) { record('manifest.json:合法 JSON', 'FAIL', 'parse error: ' + r.err); return null; }
  record('manifest.json:合法 JSON', 'PASS', 'parsed ' + fs.statSync(MANIFEST).size + ' bytes');

  var m = r.data;
  var requiredKeys = ['voice', 'rates', 'word', 'ex', 'grammar', 'writing', 'reading'];
  var missing = requiredKeys.filter(function (k) { return !(k in m); });
  if (missing.length) {
    record('manifest.json:七個 key 齊全', 'FAIL', '缺: ' + missing.join(','));
  } else {
    record('manifest.json:七個 key 齊全', 'PASS', 'voice/rates/word/ex/grammar/writing/reading');
  }

  var counts = {
    word:    Object.keys(m.word    || {}).length,
    ex:      Object.keys(m.ex      || {}).length,
    grammar: Object.keys(m.grammar || {}).length,
    writing: Object.keys(m.writing || {}).length,
    reading: Object.keys(m.reading || {}).length
  };
  var expected = { word: 336, ex: 336, grammar: 16, writing: 40, reading: 56 };
  var okCount = true;
  Object.keys(expected).forEach(function (k) {
    if (counts[k] !== expected[k]) {
      record('manifest.json:' + k + ' 數量=' + expected[k], 'FAIL', '實際=' + counts[k]);
      okCount = false;
    } else {
      record('manifest.json:' + k + ' 數量=' + expected[k], 'PASS', '');
    }
  });
  if (okCount) record('manifest.json:全部數量符合預期', 'PASS', JSON.stringify(counts));
  return m;
}

// ───────────────────────── SECTION 2: path format ─────────────────────────
function section2_pathFormat(m) {
  console.log('\n—— SECTION 2: manifest 音檔路徑格式 ——');
  if (!m) { record('path 格式', 'PENDING', 'manifest 不可用'); return; }
  var re = /^audio\/(word|ex|grammar|writing|reading)\/.+\.mp3$/;
  var bad = [];
  var total = 0;

  // word/ex/writing: {id: {n,s}}
  ['word', 'ex', 'writing'].forEach(function (scope) {
    var bucket = m[scope] || {};
    Object.keys(bucket).forEach(function (id) {
      var entry = bucket[id];
      if (!entry || typeof entry !== 'object') { bad.push(scope + ':' + id + ' not object'); return; }
      ['n', 's'].forEach(function (sp) {
        var p = entry[sp];
        total++;
        if (typeof p !== 'string' || !re.test(p)) bad.push(scope + ':' + id + '.' + sp + ' = ' + p);
      });
    });
  });

  // grammar: {id: [ {n,s}, ... ]}
  (m.grammar || {}); // ensure exists
  Object.keys(m.grammar || {}).forEach(function (id) {
    var arr = m.grammar[id];
    if (!Array.isArray(arr)) { bad.push('grammar:' + id + ' not array'); return; }
    arr.forEach(function (entry, idx) {
      ['n', 's'].forEach(function (sp) {
        var p = entry[sp];
        total++;
        if (typeof p !== 'string' || !re.test(p)) bad.push('grammar:' + id + '[' + idx + '].' + sp + ' = ' + p);
      });
    });
  });

  // reading: {id: { audio: [path...] }}
  Object.keys(m.reading || {}).forEach(function (id) {
    var arr = (m.reading[id] || {}).audio || [];
    if (!Array.isArray(arr)) { bad.push('reading:' + id + ' audio not array'); return; }
    arr.forEach(function (p, idx) {
      total++;
      if (typeof p !== 'string' || !re.test(p)) bad.push('reading:' + id + '[' + idx + '] = ' + p);
    });
  });

  if (bad.length === 0) record('path 格式 (regex)', 'PASS', total + ' 筆路徑全部符合 /audio/<scope>/...mp3/');
  else record('path 格式 (regex)', 'FAIL', bad.length + ' 筆不合規', bad.slice(0, 10).join('\n'));
}

// ───────────────────────── SECTION 3: file existence sampling ─────────────────────────
function section3_fileExists(m) {
  console.log('\n—— SECTION 3: 抽樣 mp3 檔存在性 ——');
  if (!m) { record('抽樣檔案存在', 'PENDING', 'manifest 不可用'); return; }

  function pick(scope, n) {
    var out = [];
    if (scope === 'word' || scope === 'ex' || scope === 'writing') {
      var keys = Object.keys(m[scope] || {}).slice(0, n);
      keys.forEach(function (k) {
        var entry = m[scope][k];
        out.push(path.join(ROOT, entry.n));
        out.push(path.join(ROOT, entry.s));
      });
    } else if (scope === 'grammar') {
      var gkeys = Object.keys(m.grammar || {}).slice(0, n);
      gkeys.forEach(function (k) {
        var arr = m.grammar[k] || [];
        arr.forEach(function (e) { out.push(path.join(ROOT, e.n)); out.push(path.join(ROOT, e.s)); });
      });
    } else if (scope === 'reading') {
      var rkeys = Object.keys(m.reading || {}).slice(0, n);
      rkeys.forEach(function (k) {
        var arr = (m.reading[k] || {}).audio || [];
        arr.forEach(function (p) { out.push(path.join(ROOT, p)); });
      });
    }
    return out;
  }

  var scopes = ['word', 'ex', 'grammar', 'writing', 'reading'];
  var totalCheck = 0, totalMiss = 0, totalSize = 0;
  var missSamples = [];
  scopes.forEach(function (scope) {
    var files = pick(scope, 5);
    if (files.length === 0) {
      record('抽樣:' + scope, 'PENDING', '該類別沒有任何檔案');
      return;
    }
    var miss = 0, size = 0;
    files.forEach(function (f) {
      totalCheck++;
      if (fs.existsSync(f)) {
        size += fs.statSync(f).size;
      } else {
        miss++;
        if (missSamples.length < 5) missSamples.push(path.relative(ROOT, f));
      }
    });
    totalMiss += miss;
    totalSize += size;
    if (miss === 0) record('抽樣:' + scope + ' 前 5 筆', 'PASS', files.length + ' 檔存在，共 ' + size + ' bytes');
    else record('抽樣:' + scope + ' 前 5 筆', 'WARN', miss + '/' + files.length + ' 缺檔（音檔可能仍在補生成）');
  });
  if (totalMiss === 0) record('抽樣檔案存在性（總）', 'PASS', totalCheck + ' 檔全存，共 ' + totalSize + ' bytes');
  else record('抽樣檔案存在性（總）', 'WARN', totalMiss + '/' + totalCheck + ' 缺檔；範例: ' + missSamples.join(', '));
}

// ───────────────────────── SECTION 4: SEAudio via vm ─────────────────────────
function section4_seAudio() {
  console.log('\n—— SECTION 4: js/audio.js (SEAudio) ——');
  var f = path.join(ROOT, 'js', 'audio.js');
  if (!fs.existsSync(f)) {
    record('SEAudio:載入', 'PENDING', 'A1 尚未寫 js/audio.js');
    return Promise.resolve();
  }
  // 假 manifest：給 word/ex 各放一筆可命中、一筆查不到
  var fakeManifest = {
    voice: 'en-US-AriaNeural',
    rates: { n: '+0%', s: '-25%' },
    word: {
      'w1d1a': { n: 'audio/word/w1d1a_n.mp3', s: 'audio/word/w1d1a_s.mp3' },
      'w1d1b': { n: 'audio/word/w1d1b_n.mp3', s: 'audio/word/w1d1b_s.mp3' }
    },
    ex: {
      'w1d1a': { n: 'audio/ex/w1d1a_n.mp3', s: 'audio/ex/w1d1a_s.mp3' }
    },
    grammar: {
      'g1': [
        { n: 'audio/grammar/g1_e0_n.mp3', s: 'audio/grammar/g1_e0_s.mp3' },
        { n: 'audio/grammar/g1_e1_n.mp3', s: 'audio/grammar/g1_e1_s.mp3' }
      ]
    },
    writing: {
      '1-0': { n: 'audio/writing/1-0_n.mp3', s: 'audio/writing/1-0_s.mp3' }
    },
    reading: {
      'r0706': {
        sentences: ['Hello', 'World'],
        audio: ['audio/reading/r0706_s0.mp3', 'audio/reading/r0706_s1.mp3']
      }
    }
  };
  var loaded = loadInSandbox(f, { manifest: fakeManifest, settings: { ttsNormal: true } });
  if (!loaded || !loaded.ok) {
    record('SEAudio:載入', 'FAIL', 'vm 載入失敗: ' + (loaded && loaded.err));
    return Promise.resolve();
  }
  record('SEAudio:載入', 'PASS', 'vm 載入成功');

  var SEAudio = loaded.sandbox.window.SEAudio;
  if (!SEAudio) { record('SEAudio:window.SEAudio 存在', 'FAIL', '未掛到 window'); return Promise.resolve(); }
  record('SEAudio:window.SEAudio 存在', 'PASS', '');

  // currentSpeed
  try {
    var sp = SEAudio.currentSpeed();
    if (sp === 'n' || sp === 's') record('SEAudio.currentSpeed', 'PASS', '回 ' + sp);
    else record('SEAudio.currentSpeed', 'FAIL', '回 ' + sp);
  } catch (e) { record('SEAudio.currentSpeed', 'FAIL', e.message); }

  // 先 await init()，確保 manifest 載入完成
  return SEAudio.init().then(function () {
    // src(word, w1d1a, n) — 命中
    try {
      var p = SEAudio.src('word', 'w1d1a', 'n');
      if (p === 'audio/word/w1d1a_n.mp3') record('SEAudio.src(word,hit,n)', 'PASS', p);
      else record('SEAudio.src(word,hit,n)', 'FAIL', '回 ' + p);
    } catch (e) { record('SEAudio.src(word,hit,n)', 'FAIL', e.message); }

    // src(word, w1d1a, s) — 命中
    try {
      var p2 = SEAudio.src('word', 'w1d1a', 's');
      if (p2 === 'audio/word/w1d1a_s.mp3') record('SEAudio.src(word,hit,s)', 'PASS', p2);
      else record('SEAudio.src(word,hit,s)', 'FAIL', '回 ' + p2);
    } catch (e) { record('SEAudio.src(word,hit,s)', 'FAIL', e.message); }

    // src(word, unknown, n) — null
    try {
      var p3 = SEAudio.src('word', 'nope_does_not_exist', 'n');
      if (p3 === null) record('SEAudio.src(word,miss,n)', 'PASS', '回 null');
      else record('SEAudio.src(word,miss,n)', 'FAIL', '應為 null，實際=' + p3);
    } catch (e) { record('SEAudio.src(word,miss,n)', 'FAIL', e.message); }

    // src(ex, w1d1a, n) — 命中
    try {
      var p4 = SEAudio.src('ex', 'w1d1a', 'n');
      if (p4 === 'audio/ex/w1d1a_n.mp3') record('SEAudio.src(ex,hit,n)', 'PASS', p4);
      else record('SEAudio.src(ex,hit,n)', 'FAIL', '回 ' + p4);
    } catch (e) { record('SEAudio.src(ex,hit,n)', 'FAIL', e.message); }

    // src(grammar, g1, n, 0) — 命中
    try {
      var p5 = SEAudio.src('grammar', 'g1', 'n', 0);
      if (p5 === 'audio/grammar/g1_e0_n.mp3') record('SEAudio.src(grammar,hit,n,0)', 'PASS', p5);
      else record('SEAudio.src(grammar,hit,n,0)', 'FAIL', '回 ' + p5);
    } catch (e) { record('SEAudio.src(grammar,hit,n,0)', 'FAIL', e.message); }

    // src(writing, 1-0, n) — 命中
    try {
      var p6 = SEAudio.src('writing', '1-0', 'n');
      if (p6 === 'audio/writing/1-0_n.mp3') record('SEAudio.src(writing,hit,n)', 'PASS', p6);
      else record('SEAudio.src(writing,hit,n)', 'FAIL', '回 ' + p6);
    } catch (e) { record('SEAudio.src(writing,hit,n)', 'FAIL', e.message); }

    // src(reading, r0706, n, 1) — 命中
    try {
      var p7 = SEAudio.src('reading', 'r0706', 'n', 1);
      if (p7 === 'audio/reading/r0706_s1.mp3') record('SEAudio.src(reading,hit,n,1)', 'PASS', p7);
      else record('SEAudio.src(reading,hit,n,1)', 'FAIL', '回 ' + p7);
    } catch (e) { record('SEAudio.src(reading,hit,n,1)', 'FAIL', e.message); }

    // play 在 src=null 時應該走 SETts 備援
    loaded.calls.SETtsSpeak.length = 0;
    loaded.calls.SETtsStop = 0;
    try {
      var pr = SEAudio.play({
        scope: 'word', id: 'totally_missing', speed: 'n',
        fallbackText: 'FALLBACK_HELLO_WORLD', btnEl: null
      });
      if (pr && typeof pr.then === 'function') {
        return pr.then(function () {
          var got = loaded.calls.SETtsSpeak;
          if (got.some(function (c) { return c.text === 'FALLBACK_HELLO_WORLD'; })) {
            record('SEAudio.play(src=null) → SETts.speak 備援', 'PASS', '收到 fallback text: FALLBACK_HELLO_WORLD');
          } else {
            record('SEAudio.play(src=null) → SETts.speak 備援', 'FAIL', 'SETts.speak 未收到 fallbackText，calls=' + JSON.stringify(got));
          }
        }).catch(function (e) {
          record('SEAudio.play(src=null) → SETts.speak 備援', 'FAIL', 'rejected: ' + e.message);
        }).then(function () {
          return section4b_playSequence(loaded, SEAudio);
        });
      } else {
        var got2 = loaded.calls.SETtsSpeak;
        if (got2.some(function (c) { return c.text === 'FALLBACK_HELLO_WORLD'; })) {
          record('SEAudio.play(src=null) → SETts.speak 備援', 'PASS', '收到 fallback text (sync)');
        } else {
          record('SEAudio.play(src=null) → SETts.speak 備援', 'FAIL', 'SETts.speak 未收到 fallbackText');
        }
        return section4b_playSequence(loaded, SEAudio);
      }
    } catch (e) {
      record('SEAudio.play(src=null) → SETts.speak 備援', 'FAIL', 'threw: ' + e.message);
      return section4b_playSequence(loaded, SEAudio);
    }
  }).catch(function (e) {
    record('SEAudio.init()', 'FAIL', 'rejected: ' + e.message);
  });
}

function section4b_playSequence(loaded, SEAudio) {
  // playSequence：給定 3 個 item，必須依序觸發播放
  // 等 stop 刪除後我們直接呼叫 playSequence，先檢查它存在跟回 controller.stop
  try {
    var before = loaded.calls.audioInstances;
    var items = [
      { scope: 'word', id: 'w1d1a', fallbackText: 'one' },
      { scope: 'word', id: 'w1d1b', fallbackText: 'two' },
      { scope: 'ex',   id: 'w1d1a', fallbackText: 'three' }
    ];
    if (typeof SEAudio.playSequence !== 'function') {
      record('SEAudio.playSequence 存在', 'FAIL', '不是 function');
      return Promise.resolve();
    }
    record('SEAudio.playSequence 存在', 'PASS', '');
    var seq = SEAudio.playSequence(items, { speed: 'n', onItem: function () {}, onDone: function () {} });
    if (seq && typeof seq.stop === 'function') record('SEAudio.playSequence 回 controller.stop', 'PASS', '');
    else record('SEAudio.playSequence 回 controller.stop', 'FAIL', '無 stop');
    // 等一個小 tick，觀察 Audio 實例增加
    return new Promise(function (resolve) {
      setTimeout(function () {
        var after = loaded.calls.audioInstances;
        if (after > before) record('SEAudio.playSequence 有觸發播放', 'PASS', 'Audio instances ' + before + '→' + after);
        else record('SEAudio.playSequence 有觸發播放', 'FAIL', 'Audio instances 未增加（src=null 全部走備援？）');
        // 測完之後停掉，避免 SETts 殘留
        try { seq.stop(); } catch (e) {}
        resolve();
      }, 50);
    });
  } catch (e) {
    record('SEAudio.playSequence', 'FAIL', 'threw: ' + e.message);
    return Promise.resolve();
  }
}

// ───────────────────────── SECTION 5: SEListening via vm ─────────────────────────
function section5_seListening() {
  console.log('\n—— SECTION 5: js/listening-quiz.js (SEListening) ——');
  var f = path.join(ROOT, 'js', 'listening-quiz.js');
  if (!fs.existsSync(f)) {
    record('SEListening:載入', 'PENDING', 'A2 尚未寫 js/listening-quiz.js');
    return;
  }
  // 假 mock：給 SEListening 用的 window 環境（小 stub）
  var sandbox = {
    window: {},
    document: { addEventListener: function () {} },
    console: console,
    Math: Math,
    Date: Date,
    Object: Object,
    Array: Array,
    JSON: JSON,
    Promise: Promise,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  sandbox.window.console = console;
  sandbox.window.SEStore = { getSettings: function () { return {}; } };
  sandbox.window.SETts   = { speak: function () {}, stop: function () {} };
  try {
    vm.createContext(sandbox);
    var src = fs.readFileSync(f, 'utf8');
    new vm.Script(src, { filename: f }).runInContext(sandbox);
  } catch (e) {
    record('SEListening:載入', 'FAIL', 'vm 載入失敗: ' + e.message);
    return;
  }
  record('SEListening:載入', 'PASS', 'vm 載入成功');
  var SEListening = sandbox.window.SEListening;
  if (!SEListening) { record('SEListening:window.SEListening 存在', 'FAIL', '未掛到 window'); return; }
  record('SEListening:window.SEListening 存在', 'PASS', '');

  // 假資料：8 個字
  var words = [
    { id: 'w1d1a', en: 'apple',     kk: 'ˈæpəl',     pos: 'n', zh: '蘋果',     ex: 'I eat an apple.',     ex_zh: '我吃一顆蘋果。' },
    { id: 'w1d1b', en: 'banana',    kk: 'bəˈnænə',   pos: 'n', zh: '香蕉',     ex: 'I like bananas.',     ex_zh: '我喜歡香蕉。' },
    { id: 'w1d1c', en: 'cat',       kk: 'kæt',       pos: 'n', zh: '貓',       ex: 'The cat is cute.',    ex_zh: '這隻貓很可愛。' },
    { id: 'w1d1d', en: 'dog',       kk: 'dɔɡ',       pos: 'n', zh: '狗',       ex: 'My dog runs fast.',   ex_zh: '我的狗跑得快。' },
    { id: 'w1d1e', en: 'egg',       kk: 'ɛɡ',        pos: 'n', zh: '蛋',       ex: 'I eat an egg.',       ex_zh: '我吃一顆蛋。' },
    { id: 'w1d1f', en: 'fish',      kk: 'fɪʃ',       pos: 'n', zh: '魚',       ex: 'Fish swim in water.',ex_zh: '魚在水中游。' },
    { id: 'w1d1g', en: 'goat',      kk: 'ɡoʊt',      pos: 'n', zh: '山羊',     ex: 'The goat eats grass.',ex_zh: '山羊吃草。' },
    { id: 'w1d1h', en: 'hat',       kk: 'hæt',       pos: 'n', zh: '帽子',     ex: 'I wear a hat.',       ex_zh: '我戴帽子。' }
  ];
  var q;
  try {
    q = SEListening.makeQuestions(words, 5);
  } catch (e) {
    record('SEListening.makeQuestions', 'FAIL', 'threw: ' + e.message);
    return;
  }
  if (!Array.isArray(q)) { record('SEListening.makeQuestions 回傳 array', 'FAIL', typeof q); return; }
  record('SEListening.makeQuestions 回傳 array', 'PASS', q.length + ' 題');

  if (q.length !== 5) {
    record('SEListening.makeQuestions 題數=n', 'FAIL', '預期 5 實際 ' + q.length);
  } else {
    record('SEListening.makeQuestions 題數=n', 'PASS', '');
  }

  // 逐題 schema 檢查
  var schemaBad = [];
  q.forEach(function (it, i) {
    if (typeof it.k !== 'string' || it.k.indexOf('l:') !== 0) schemaBad.push(i + ':k=' + it.k);
    if (it.t !== 'listening') schemaBad.push(i + ':t=' + it.t);
    if (!it.audio || it.audio.scope !== 'word') schemaBad.push(i + ':audio.scope=' + (it.audio && it.audio.scope));
    if (!Array.isArray(it.options) || it.options.length !== 4) schemaBad.push(i + ':options=' + JSON.stringify(it.options));
    if (typeof it.answer !== 'string') schemaBad.push(i + ':answer 不是字串');
    if (it.options && it.options.indexOf(it.answer) === -1) schemaBad.push(i + ':answer 不在 options 內 (' + it.answer + ')');
  });
  if (schemaBad.length === 0) record('SEListening 題目 schema 全合', 'PASS', '5/5 題');
  else record('SEListening 題目 schema', 'FAIL', schemaBad.length + ' 題不合', schemaBad.slice(0, 5).join('\n'));
}

// ───────────────────────── SECTION 6: syntax check ─────────────────────────
function section6_syntax() {
  console.log('\n—— SECTION 6: js/*.js 語法檢查（vm.Script）——');
  var targets = ['audio.js', 'listening-quiz.js', 'reading-follow.js'];
  var passed = 0, failed = 0, pending = 0;
  targets.forEach(function (name) {
    var p = path.join(ROOT, 'js', name);
    var ok = syntaxCheck('node --check: ' + name, p);
    if (ok) passed++;
    else if (results.filter(function (r) { return r.name === 'node --check: ' + name; })[0].status === 'PENDING') pending++;
    else failed++;
  });
  record('語法檢查 彙整', failed === 0 ? 'PASS' : 'FAIL', 'PASS=' + passed + ' FAIL=' + failed + ' PENDING=' + pending);
}

// ───────────────────────── REPORT ─────────────────────────
function writeReport() {
  var pass = results.filter(function (r) { return r.status === 'PASS'; }).length;
  var warn = results.filter(function (r) { return r.status === 'WARN'; }).length;
  var fail = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  var pend = results.filter(function (r) { return r.status === 'PENDING'; }).length;
  var info = results.filter(function (r) { return r.status === 'INFO'; }).length;

  var lines = [];
  lines.push('# A4 測試報告');
  lines.push('');
  lines.push('產生時間：' + new Date().toISOString());
  lines.push('執行位置：' + ROOT);
  lines.push('退出碼：' + (fatal ? 1 : 0));
  lines.push('');
  lines.push('## 摘要');
  lines.push('');
  lines.push('| 狀態 | 數量 |');
  lines.push('|------|------|');
  lines.push('| PASS    | ' + pass + ' |');
  lines.push('| WARN    | ' + warn + ' |');
  lines.push('| FAIL    | ' + fail + ' |');
  lines.push('| PENDING | ' + pend + ' |');
  lines.push('| INFO    | ' + info + ' |');
  lines.push('| **總計** | **' + results.length + '** |');
  lines.push('');
  lines.push('## 結果明細');
  lines.push('');
  lines.push('| 項目 | 狀態 | 訊息 |');
  lines.push('|------|------|------|');
  results.forEach(function (r) {
    var msg = (r.message || '').replace(/\|/g, '\\|');
    lines.push('| ' + r.name + ' | ' + r.status + ' | ' + msg + ' |');
  });
  if (results.some(function (r) { return r.detail; })) {
    lines.push('');
    lines.push('## 失敗/Pending 細節');
    lines.push('');
    results.forEach(function (r) {
      if (r.detail) {
        lines.push('### ' + r.name + ' [' + r.status + ']');
        lines.push('');
        lines.push('```');
        lines.push(r.detail);
        lines.push('```');
        lines.push('');
      }
    });
  }
  // 邊界備註
  lines.push('');
  lines.push('## 邊界與註記');
  lines.push('');
  lines.push('- 純 Node + fs + vm + 內建模組，無外部套件、無瀏覽器。');
  lines.push('- 不讀 .mp3 二進位，只檢查存在性與大小。');
  lines.push('- 對 js/* 用 vm.Script 等同 `node --check`。');
  lines.push('- 對 js/audio.js、js/listening-quiz.js 在 sandbox 內以假 SETts / SEStore / fetch / Audio 載入並做行為驗證。');
  lines.push('- 抽樣檔案存在性：缺檔只記 WARN（音檔可能仍在補生成）。');
  lines.push('');

  fs.mkdirSync(path.dirname(REPORT_OUT), { recursive: true });
  fs.writeFileSync(REPORT_OUT, lines.join('\n'), 'utf8');
  return { pass: pass, warn: warn, fail: fail, pend: pend, info: info };
}

// ───────────────────────── main ─────────────────────────
function main() {
  return Promise.resolve()
    .then(function () {
      console.log('A4 測試 — ' + (new Date().toISOString()));
      console.log('ROOT = ' + ROOT);
      var m = section1_manifestSchema();
      section2_pathFormat(m);
      section3_fileExists(m);
    })
    .then(function () { return section4_seAudio(); })
    .then(function () {
      section5_seListening();
      section6_syntax();
    })
    .then(function () {
      var summary = writeReport();
      console.log('\n====================');
      console.log('PASS=' + summary.pass + ' WARN=' + summary.warn + ' FAIL=' + summary.fail + ' PENDING=' + summary.pend);
      console.log('退出碼=' + (fatal ? 1 : 0));
      process.exit(fatal ? 1 : 0);
    })
    .catch(function (e) {
      console.error('FATAL:', e && e.stack || e);
      process.exit(2);
    });
}

main();
