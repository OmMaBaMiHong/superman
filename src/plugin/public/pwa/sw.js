/* Superman H5（DSH 插件伺服）service worker
   静态资源 cache-first；页面导航 network-first；/s/api 一律不缓存（含登录态）。 */
const STATIC_CACHE = 'superman-h5-static-v1';
const PRECACHE = [
  '/s/app/brand/pwa-icon-192.png',
  '/s/app/brand/pwa-icon-512.png',
  '/s/app/brand/pwa-icon-maskable-512.png',
  '/s/app/brand/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/s/api/')) return;

  if (url.pathname.startsWith('/s/app/')) {
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

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/s/app/index.html').then((hit) => hit || Response.error())),
    );
  }
});
