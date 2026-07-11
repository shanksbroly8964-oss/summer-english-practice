// ============================================================
// PWA — Service Worker 註冊、更新提示、安裝引導
// ============================================================
(function() {
  'use strict';

  // ── 1. 註冊 Service Worker ──
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function() {
      navigator.serviceWorker.register('sw.js').then(function(reg) {
        // 偵測到新版 SW → 提示重新整理拿新版
        reg.addEventListener('updatefound', function() {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function() {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBar(reg);
            }
          });
        });
      }).catch(function(err) {
        console.warn('SW 註冊失敗:', err);
      });

      // 新 SW 接管後自動重載一次（拿到新版前端）
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function() {
        if (reloaded) return;
        reloaded = true;
        window.location.reload();
      });
    });
  }

  function showUpdateBar(reg) {
    var hint = document.getElementById('install-hint');
    var text = document.getElementById('install-hint-text');
    var action = document.getElementById('install-hint-action');
    if (!hint) return;
    text.textContent = '有新版本可用';
    action.textContent = '更新';
    action.hidden = false;
    hint.hidden = false;
    action.onclick = function() {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
      hint.hidden = true;
    };
    document.getElementById('install-hint-close').onclick = function() { hint.hidden = true; };
  }

  // ── 2. 安裝引導 ──
  var DISMISS_KEY = 'se_install_hint_dismissed';
  var deferredPrompt = null;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }
  function alreadyDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch (e) { return false; }
  }
  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch (e) {}
    var hint = document.getElementById('install-hint');
    if (hint) hint.hidden = true;
  }

  function showHint(message, withAction) {
    if (isStandalone() || alreadyDismissed()) return;
    var hint = document.getElementById('install-hint');
    var text = document.getElementById('install-hint-text');
    var action = document.getElementById('install-hint-action');
    var close = document.getElementById('install-hint-close');
    if (!hint) return;
    text.textContent = message;
    action.hidden = !withAction;
    hint.hidden = false;
    close.onclick = dismiss;
    if (withAction) {
      action.textContent = '安裝到主畫面';
      action.onclick = function() {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then(function(res) {
          if (res.outcome === 'accepted') dismiss();
          deferredPrompt = null;
          hint.hidden = true;
        });
      };
    }
  }

  // Android / 桌面 Chrome：攔截安裝事件，改用自訂按鈕
  window.addEventListener('beforeinstallprompt', function(e) {
    e.preventDefault();
    deferredPrompt = e;
    // 延遲一下再提示，別打斷剛進來的使用者
    setTimeout(function() { showHint('把「暑假英文」安裝到主畫面，開起來像 App！', true); }, 4000);
  });

  window.addEventListener('appinstalled', function() { dismiss(); });

  // iOS Safari：沒有 beforeinstallprompt，改教學分享→加入主畫面
  window.addEventListener('load', function() {
    if (isIOS() && !isStandalone() && !alreadyDismissed()) {
      setTimeout(function() {
        showHint('安裝到主畫面：點下方「分享」→「加入主畫面」', false);
      }, 4500);
    }
  });
})();
