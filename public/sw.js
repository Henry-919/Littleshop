const CACHE_NAME = 'xiaodian-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json',
    '/icon-192.svg',
    '/icon-512.svg'
];

// Install phase: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try to add each asset individually and ignore failures (missing files)
      await Promise.allSettled(ASSETS_TO_CACHE.map(async (asset) => {
        try {
          await cache.add(asset);
        } catch (e) {
          console.warn('[SW] Failed to cache', asset, e && e.message);
        }
      }));
    })
  );
  self.skipWaiting();
});

// Activate phase: clear old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  // Take control of uncontrolled clients as soon as the worker activates
  if (self.clients && self.clients.claim) {
    self.clients.claim();
  }
});

// Strategy: network first, but exclude AI APIs
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 🚨 关键：如果是调用 AI 识别接口，直接走网络，不进入缓存逻辑
  if (url.pathname.startsWith('/api/')) {
    return; 
  }

  event.respondWith(
    fetch(event.request).catch(() => {
      return caches.match(event.request);
    })
  );
});
