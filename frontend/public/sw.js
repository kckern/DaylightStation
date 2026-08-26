// Shared Daylight shell cache. User-specific API/media responses are never
// cached here; Feed offline editions live in user-scoped IndexedDB.
//
// v2: v1 wrote nothing at runtime. It cloned each response inside the async
// continuation of caches.open(), by which point the consumer had already begun
// reading the body, so clone() threw and the put never ran. The only entries
// the cache ever held were the two seeded at install, which is also why the
// offline fallback served a shell frozen at whenever this file last changed.
const SHELL_CACHE = 'daylight-shell-v2';
const SHELL_URLS = ['/', '/manifest.json'];

// Vite emits content-hashed bundles into /assets (CardGame-BDscaYCL.js). The
// hash IS the version, so those may be served from cache indefinitely. Anything
// shipped under a stable name -- icons, fonts, manifest -- must revalidate, or
// the first byte ever fetched wins permanently and no amount of hard-refreshing
// at the kiosk dislodges it. Anything that does not clearly look hashed falls
// through to the revalidating path, so a miss here costs freshness, never
// correctness.
const IMMUTABLE = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/;

// A hashed asset is never evicted by a newer build, so entries accumulate one
// deploy at a time on a kiosk that runs for months. Keep the tail bounded.
const MAX_ENTRIES = 120;

function trim(cache) {
  return cache.keys().then(keys => {
    if (keys.length <= MAX_ENTRIES) return undefined;
    // Cache.keys() resolves in insertion order, so the front is the oldest.
    return Promise.all(keys.slice(0, keys.length - MAX_ENTRIES).map(key => cache.delete(key)));
  });
}

// Clone BEFORE the response is handed onward: clone() throws once the body has
// been consumed, and the consumer starts reading the moment we return. The
// write itself is fire-and-forget, and a failed one must never surface as a
// page error.
function cacheCopy(key, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(SHELL_CACHE)
    .then(cache => cache.put(key, copy).then(() => trim(cache)))
    .catch(() => {});
  return response;
}

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
      .then(response => cacheCopy('/', response))
      .catch(() => caches.match('/')));
    return;
  }

  if (!['script', 'style', 'font', 'image'].includes(request.destination)) return;

  if (IMMUTABLE.test(url.pathname)) {
    event.respondWith(caches.match(request)
      .then(cached => cached || fetch(request).then(response => cacheCopy(request, response))));
    return;
  }

  // Stable-named asset: the network decides, the cache is only the offline net.
  event.respondWith(fetch(request)
    .then(response => cacheCopy(request, response))
    .catch(() => caches.match(request)));
});
