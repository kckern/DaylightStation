// Minimal service worker for Feed PWA installability
// Scoped to /feed — covers feed routes (scroll, reader, headlines)
// No offline caching for now — just satisfies Chrome's install criteria

self.addEventListener('fetch', () => {});
