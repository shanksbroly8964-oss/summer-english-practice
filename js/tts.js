// ============================================================
// TTS — Web Speech API 朗讀（en-US）
// 預設慢速 0.55（GEPT 教訓：對國中生太快），可切換正常 0.8
// ============================================================
window.SETts = (function() {
  'use strict';

  var synth = window.speechSynthesis || null;
  var enVoice = null;
  var currentBtn = null;

  var RATES = { slow: 0.55, normal: 0.8 };

  function pickVoice() {
    if (!synth) return;
    var voices = synth.getVoices() || [];
    // 優先 en-US，其次任何 en
    enVoice = voices.find(function(v) { return /^en[-_]US/i.test(v.lang); }) ||
              voices.find(function(v) { return /^en/i.test(v.lang); }) || null;
  }
  if (synth) {
    pickVoice();
    if (typeof synth.onvoiceschanged !== 'undefined') synth.onvoiceschanged = pickVoice;
  }

  function getRate() {
    var s = window.SEStore ? window.SEStore.getSettings() : {};
    return s.ttsNormal ? RATES.normal : RATES.slow;
  }

  function clearBtn() {
    if (currentBtn) { currentBtn.classList.remove('speaking'); currentBtn = null; }
  }

  function speak(text, btn, rateOverride) {
    if (!synth || !text) return;
    synth.cancel();
    clearBtn();

    var u = new SpeechSynthesisUtterance(String(text));
    u.lang = 'en-US';
    if (enVoice) u.voice = enVoice;
    u.rate = rateOverride || getRate();
    u.pitch = 1;

    if (btn) { currentBtn = btn; btn.classList.add('speaking'); }
    u.onend = clearBtn;
    u.onerror = clearBtn;
    synth.speak(u);
  }

  function stop() {
    if (synth) synth.cancel();
    clearBtn();
  }

  return { speak: speak, stop: stop, RATES: RATES };
})();

// 全域點擊代理：任何帶 data-tts 的按鈕都可朗讀
document.addEventListener('click', function(e) {
  var btn = e.target.closest('[data-tts]');
  if (!btn) return;
  e.preventDefault();
  var text = btn.getAttribute('data-tts');
  if (btn.classList.contains('speaking')) { window.SETts.stop(); return; }
  window.SETts.speak(text, btn);
});
