// このアプリが Service Worker を持つ唯一の目的は「更新を確実に届けること」。
// iOSのホーム画面アプリはHTMLを強くキャッシュし、SWが無いと古い版が貼り付いたまま
// 剥がれない（2026-09-22に実際に発生）。
// したがってキャッシュは常にネットワークの後ろに置き、オフライン時の保険としてのみ使う。
const CACHE = 'hamrehab';

self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // 200以外(404等)をキャッシュすると、それが offline fallback として残り続ける
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
