// ============================================================
// SEAuth — Firebase Google 登入 + Firestore 雲端同步
// Firestore: users/{uid} 巢狀欄位 summer（merge:true，不碰其他工具欄位）
// 自我隔離：僅操作 #auth-container
// ============================================================
window.SEAuth = (function() {
  'use strict';

  var FB_CDN = 'https://www.gstatic.com/firebasejs/10.12.0';
  var SDK_LOADED = false;

  var auth = null;
  var db = null;
  var currentUser = null;

  function isPlaceholder(val) { return !val || /^YOUR_/.test(val); }
  function isConfigValid() {
    try {
      var c = firebaseConfig;
      return !isPlaceholder(c.apiKey) && !isPlaceholder(c.projectId) && !isPlaceholder(c.appId);
    } catch (e) { return false; }
  }
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

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

  function renderUI() {
    var container = document.getElementById('auth-container');
    if (!container) return;
    if (currentUser) {
      var avatar = currentUser.photoURL ? escapeHtml(currentUser.photoURL) : '';
      var name = currentUser.displayName || currentUser.email || '使用者';
      container.innerHTML =
        '<div style="display:flex;align-items:center;gap:6px;">' +
          (avatar ? '<img src="' + avatar + '" alt="" style="width:28px;height:28px;border-radius:50%;border:2px solid #fff;">' : '') +
          '<button onclick="window.SEAuth.logout()" ' +
            'style="padding:5px 10px;border:1px solid rgba(255,255,255,.6);border-radius:8px;background:transparent;color:#fff;cursor:pointer;font-size:12px;">' +
            escapeHtml(name.split(' ')[0]) + '｜登出</button>' +
        '</div>';
    } else {
      container.innerHTML =
        '<button onclick="window.SEAuth.login()" ' +
          'style="display:flex;align-items:center;gap:6px;padding:6px 12px;border:none;border-radius:8px;' +
          'background:#fff;color:#0e7490;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,.2);">' +
          '<span style="color:#4285f4;font-weight:800;">G</span>登入同步' +
        '</button>';
    }
  }
  function showUnconfigured() {
    var container = document.getElementById('auth-container');
    if (container) container.innerHTML = '<span style="font-size:12px;opacity:.8;">☁️ 未設定</span>';
  }

  function init() {
    renderUI();
    if (!isConfigValid()) { showUnconfigured(); return; }
    loadFirebaseSdk().then(function() {
      if (typeof firebase === 'undefined') { showUnconfigured(); return; }
      try {
        firebase.initializeApp(firebaseConfig);
      } catch (e) {
        if (e.code !== 'app/duplicate-app') { showUnconfigured(); return; }
      }
      auth = firebase.auth();
      db = firebase.firestore();
      auth.onAuthStateChanged(function(user) {
        var wasLoggedOut = !currentUser;
        currentUser = user;
        renderUI();
        if (user && wasLoggedOut) {
          // 登入後：拉雲端 → 與本機合併 → 推回雲端
          loadProgress().then(function(data) {
            if (data && data.summer) window.SEStore.mergeCloud(data.summer);
            window.SEStore.pushToCloud();
            if (window.SEApp) {
              window.SEApp.toast('☁️ 雲端紀錄已同步！');
              window.SEApp.route(); // 重繪目前頁面（進度/錯題可能更新）
            }
          });
        }
      });
    }).catch(function(err) {
      console.warn('Firebase SDK load failed:', err);
      showUnconfigured();
    });
  }

  function login() {
    if (!auth) { if (window.SEApp) window.SEApp.toast('雲端同步尚未就緒，請稍候再試'); return; }
    var provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider).catch(function(err) {
      console.error('Google 登入失敗:', err.message || err);
      if (window.SEApp) window.SEApp.toast('登入失敗：' + (err.message || err.code || ''));
    });
  }
  function logout() {
    if (!auth) return;
    auth.signOut().then(function() {
      if (window.SEApp) window.SEApp.toast('已登出（本機紀錄仍保留）');
    });
  }

  function getUser() { return currentUser || null; }

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
