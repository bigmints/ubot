// Shared-domain worker: cache only public relay assets, never pages or messages.
const CACHE_NAME = 'youbot-webchat-v2';
const STATIC_ASSETS = ['/widget.js', '/icon-192.svg', '/icon-512.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('youbot-webchat-') && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )));
  self.clients.claim();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin
    || !STATIC_ASSETS.includes(url.pathname) || url.search) return;
  // Fresh script first; retain an offline fallback only for this allowlist.
  event.respondWith(fetch(event.request).then(async (response) => {
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(event.request, response.clone());
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    return cached || Response.error();
  }));
});
