// Minimal service worker for PWA installability
// Scoped to / — covers all app routes (feed, media, call, admin)
// No offline caching for now — just satisfies Chrome's install criteria

self.addEventListener('fetch', () => {});
