// ============================================================
// SEAuth — Firebase Google 登入 + Firestore 雲端同步
//  - 登入前門（#auth-gate）：載入中 → 登入頁 or App，避免閃爍
//  - 持久化 LOCAL：關掉再開 / 重新整理都保持登入
//  - 訪客模式：可「先不登入，直接使用」（純本機）
//  - 資料隔離：users/{uid} 巢狀欄位 summer（merge:true）
// ============================================================
window.SEAuth = (function() {
  'use strict';

  var FB_CDN = 'https://www.gstatic.com/firebasejs/10.12.0';
  var SDK_LOADED = false;

  var auth = null;
  var db = null;
  var currentUser = null;
  var resolvedOnce = false;

  var GUEST_KEY = 'se_guest';

  // ── helpers ──
  function isPlaceholder(val) { return !val || /^YOUR_/.test(val); }
  function isConfigValid() {
    try {
      var c = firebaseConfig;
      return !isPlaceholder(c.apiKey) && !isPlaceholder(c.projectId) && !isPlaceholder(c.appId);
    } catch (e) { return false; }
  }
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function isGuest() {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch (e) { return false; }
  }
  function setGuest(on) {
    try { on ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY); } catch (e) {}
  }

  // ── 前門 UI 控制 ──
  function gate(id) { return document.getElementById(id); }
  function showGateLoading() {
    var g = gate('auth-gate'); if (!g) return;
    g.classList.remove('gate-hidden');
    gate('gate-loading').hidden = false;
    gate('gate-login').hidden = true;
  }
  function showGateLogin() {
    var g = gate('auth-gate'); if (!g) return;
    g.classList.remove('gate-hidden');
    gate('gate-loading').hidden = true;
    gate('gate-login').hidden = false;
  }
  function hideGate() {
    var g = gate('auth-gate'); if (!g) return;
    g.classList.add('gate-hidden');
  }
  function gateError(msg) {
    var e = gate('gate-error'); if (!e) return;
    e.textContent = msg;
    e.hidden = !msg;
  }

  // ── header 使用者列 ──
  function renderUI() {
    var container = document.getElementById('auth-container');
    if (!container) return;
    if (currentUser) {
      var avatar = currentUser.photoURL ? escapeHtml(currentUser.photoURL) : '';
      var name = currentUser.displayName || currentUser.email || '使用者';
      container.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;">' +
          (avatar ? '<img src="' + avatar + '" alt="" referrerpolicy="no-referrer" style="width:28px;height:28px;border-radius:50%;border:2px solid #fff;">' : '') +
          '<button onclick="window.SEAuth.logout()" ' +
            'style="padding:5px 10px;border:1px solid rgba(255,255,255,.6);border-radius:8px;background:transparent;color:#fff;cursor:pointer;font-size:12px;">' +
            escapeHtml(name.split(' ')[0]) + '｜登出</button>' +
        '</div>';
    } else {
      // 訪客模式：header 顯示登入按鈕，方便隨時升級
      container.innerHTML =
        '<button onclick="window.SEAuth.login()" ' +
          'style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:none;border-radius:8px;' +
          'background:#fff;color:#0e7490;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.2);">' +
          '<span style="color:#4285f4;font-weight:800;">G</span>登入同步' +
        '</button>';
    }
  }

  // ── SDK 載入 ──
  function loadScript(src) {
    return new Promise(function(resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.onload = resolve;
      el.onerror = function() { reject(new Error('Failed to load: ' + src)); };
      document.head.appendChild(el);
    });
  }
  function loadFirebaseSdk() {
    if (SDK_LOADED) return Promise.resolve();
    return Promise.all([
      loadScript(FB_CDN + '/firebase-app-compat.js'),
      loadScript(FB_CDN + '/firebase-auth-compat.js'),
      loadScript(FB_CDN + '/firebase-firestore-compat.js')
    ]).then(function() { SDK_LOADED = true; });
  }

  // ── 綁定前門按鈕 ──
  function bindGateButtons() {
    var gbtn = gate('gate-google-btn');
    var guest = gate('gate-guest-btn');
    if (gbtn) gbtn.onclick = function() { gateError(''); login(); };
    if (guest) guest.onclick = function() {
      setGuest(true);
      hideGate();
    };
  }

  // ── 初始化 ──
  function init() {
    bindGateButtons();
    renderUI();

    // 未設定 Firebase → 直接進 App（純本機）
    if (!isConfigValid()) {
      hideGate();
      var c = document.getElementById('auth-container');
      if (c) c.innerHTML = '<span style="font-size:12px;opacity:.8;">☁️ 未設定</span>';
      return;
    }

    showGateLoading();

    loadFirebaseSdk().then(function() {
      if (typeof firebase === 'undefined') { fallbackToGuestOrLogin(); return; }
      try {
        firebase.initializeApp(firebaseConfig);
      } catch (e) {
        if (e.code !== 'app/duplicate-app') { fallbackToGuestOrLogin(); return; }
      }
      auth = firebase.auth();
      db = firebase.firestore();

      // 明確設 LOCAL 持久化（關掉再開仍保持登入）
      auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function() {});

      auth.onAuthStateChanged(function(user) {
        var wasLoggedOut = !currentUser;
        currentUser = user;
        resolvedOnce = true;
        renderUI();

        if (user) {
          setGuest(false);
          hideGate();
          if (wasLoggedOut) {
            // 登入後：拉雲端 → 合併本機 → 推回
            loadProgress().then(function(data) {
              if (data && data.summer) window.SEStore.mergeCloud(data.summer);
              window.SEStore.pushToCloud();
              if (window.SEApp) {
                window.SEApp.toast('☁️ 雲端紀錄已同步！');
                window.SEApp.route();
              }
            });
          }
        } else {
          // 未登入：曾選訪客就直接用，否則顯示登入頁
          if (isGuest()) hideGate();
          else showGateLogin();
        }
      });
    }).catch(function(err) {
      console.warn('Firebase SDK load failed:', err);
      fallbackToGuestOrLogin();
    });
  }

  // SDK 載入失敗：曾當訪客就進 App，否則顯示登入頁並提示離線
  function fallbackToGuestOrLogin() {
    if (isGuest()) { hideGate(); }
    else { showGateLogin(); gateError('目前無法連上登入服務，可先「不登入直接使用」。'); }
  }

  // ── 登入 / 登出 ──
  function login() {
    if (!auth) {
      // 可能在 header 訪客按鈕按下、但 SDK 還沒好
      if (window.SEApp) window.SEApp.toast('登入服務準備中，請稍候再試…');
      return;
    }
    var btn = gate('gate-google-btn');
    if (btn) btn.disabled = true;
    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL)
      .then(function() { return auth.signInWithPopup(provider); })
      .then(function() { gateError(''); })
      .catch(function(err) {
        var msg = friendlyError(err);
        gateError(msg);
        if (window.SEApp) window.SEApp.toast(msg);
      })
      .then(function() { if (btn) btn.disabled = false; });
  }

  function friendlyError(err) {
    var code = (err && err.code) || '';
    if (code === 'auth/popup-closed-by-user') return '你關掉了登入視窗，可再試一次。';
    if (code === 'auth/cancelled-popup-request') return '登入已取消，請再點一次。';
    if (code === 'auth/popup-blocked') return '瀏覽器擋掉了登入視窗，請允許彈出視窗後再試。';
    if (code === 'auth/network-request-failed') return '網路連線有問題，請檢查網路後再試。';
    if (code === 'auth/unauthorized-domain') return '此網域尚未授權登入，請聯絡管理者。';
    return '登入失敗，請再試一次。' + (code ? '（' + code + '）' : '');
  }

  function logout() {
    if (!auth) return;
    auth.signOut().then(function() {
      setGuest(false);           // 登出後回到登入頁
      currentUser = null;
      renderUI();
      showGateLogin();
      if (window.SEApp) window.SEApp.toast('已登出（本機紀錄仍保留）');
    });
  }

  function getUser() { return currentUser || null; }

  // ── Firestore 同步 ──
  function syncProgress(dataObj) {
    if (!currentUser || !db) return;
    db.collection('users').doc(currentUser.uid).set(dataObj, { merge: true })
      .catch(function(err) { console.error('同步失敗:', err.message || err); });
  }
  function loadProgress() {
    return new Promise(function(resolve) {
      if (!currentUser || !db) return resolve(null);
      db.collection('users').doc(currentUser.uid).get()
        .then(function(doc) { resolve(doc.exists ? doc.data() : null); })
        .catch(function(err) { console.error('雲端載入失敗:', err.message || err); resolve(null); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    init: init, login: login, logout: logout,
    getUser: getUser, syncProgress: syncProgress, loadProgress: loadProgress
  };
})();
