/* ============================================================
   Service Worker — 暑假英文學習計畫
   策略：
   - HTML 導覽請求：network-first（拿得到新版就用新版，離線才用快取）
   - 同源靜態資源（js/css/data/icons/manifest）：cache-first + 執行期快取
   - 跨源（Firebase / gstatic / googleapis）：network-only，絕不快取
   版本控管：改前端就把 CACHE_VERSION +1，activate 時清掉舊版快取。
   ============================================================ */
const CACHE_VERSION = 'summer-en-v4';   // ← 每次改前端就 +1
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './css/style.css',
  './js/firebase-config.js',
  './js/tts.js',
  './js/storage.js',
  './js/data-loader.js',
  './js/quiz.js',
  './js/views.js',
  './js/app.js',
  './js/auth.js',
  './js/pwa.js'
];

// 跨源、不快取的網域（登入 / 資料庫 / SDK）
function isNoCacheHost(url) {
  return /(^|\.)googleapis\.com$/.test(url.hostname) ||
         /(^|\.)gstatic\.com$/.test(url.hostname) ||
         /(^|\.)firebaseio\.com$/.test(url.hostname) ||
         /(^|\.)firebaseapp\.com$/.test(url.hostname) ||
         /(^|\.)google\.com$/.test(url.hostname) ||
         /(^|\.)googleusercontent\.com$/.test(url.hostname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())        // 新 SW 立即就緒
      .catch(() => self.skipWaiting())       // 個別資源抓不到也不擋安裝
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 跨源（登入、Firestore、SDK）→ 純網路，不碰快取
  if (url.origin !== self.location.origin || isNoCacheHost(url)) {
    return; // 交給瀏覽器預設處理
  }

  // HTML 導覽 → network-first，離線退回快取
  const isNavigate = req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
  if (isNavigate) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
    return;
  }

  // 其他同源靜態資源 → cache-first，抓到就順手存起來（離線可用）
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
    })
  );
});
