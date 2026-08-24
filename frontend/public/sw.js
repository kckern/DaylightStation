// Shared Daylight shell cache. User-specific API/media responses are never
// cached here; Feed offline editions live in user-scoped IndexedDB.
const SHELL_CACHE = 'daylight-shell-v1';
const SHELL_URLS = ['/', '/manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('daylight-shell-') && key !== SHELL_CACHE)
    .map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request)
      .then(response => {
        if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put('/', response.clone()));
        return response;
      })
      .catch(() => caches.match('/')));
    return;
  }

  if (!['script', 'style', 'font', 'image'].includes(request.destination)) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) caches.open(SHELL_CACHE).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
