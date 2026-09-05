/* Superman PWA service worker
   策略：静态资源 cache-first；页面导航 network-first（离线回退 /login 缓存）；
   /api/ 一律不缓存（数据必须新鲜，且含登录态）。 */
const STATIC_CACHE = 'superman-static-v1';
const PRECACHE = ['/pwa-icon-192.png', '/pwa-icon-512.png', '/pwa-icon-maskable-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // 构建产物与图标：cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/pwa-icon') ||
    url.pathname.startsWith('/feedfuse-icon')
  ) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // 页面导航：network-first，离线回退到已缓存的登录页外壳
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('/login').then((hit) => hit || Response.error()),
      ),
    );
  }
});
