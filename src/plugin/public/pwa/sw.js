const STATIC_CACHE = 'superman-h5-static-v2';
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

  // 页面导航一律 network-first：新版本上线后刷新一次即生效，离线才回退缓存
  // （旧版把 /s/app/index.html 也 cache-first，导致发版后被钉死在旧页面）
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((hit) => hit || caches.match('/s/app/index.html'))
            .then((hit) => hit || Response.error()),
        ),
    );
    return;
  }

  // 只有带内容 hash 的 assets 才 cache-first（文件名即版本，永不过期）
  if (url.pathname.startsWith('/s/app/assets/')) {
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
  }
  // 其余 /s/app/*（index.html、brand 等）直接走网络，不进缓存
});
