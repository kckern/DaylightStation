/**
 * Contract tests for the root service worker (frontend/public/sw.js).
 *
 * These exist because the worker shipped two defects that no gate could see.
 * It runs in a ServiceWorkerGlobalScope, so nothing imported it and nothing
 * tested it; the only signal was a TypeError scrolling past in the garage
 * kiosk's journal.
 *
 * The worker source is executed here inside a simulated worker scope, against
 * the REAL WHATWG Response, so clone()/bodyUsed semantics are the platform's
 * and not a mock's approximation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const SW_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../frontend/public/sw.js'
);

const ORIGIN = 'https://daylightlocal.kckern.net';

/** Run sw.js in a fake worker scope and hand back the seams to poke at. */
function loadWorker({ network }) {
  const listeners = new Map();
  const store = new Map();          // cacheName -> Map(url -> Response)
  const netLog = [];

  const cacheFor = (name) => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name);
  };

  const cacheApi = (name) => ({
    put: async (req, res) => { cacheFor(name).set(keyOf(req), res); },
    match: async (req) => cacheFor(name).get(keyOf(req)),
    addAll: async (urls) => {
      for (const u of urls) cacheFor(name).set(u, new Response(`installed:${u}`));
    },
    keys: async () => [...cacheFor(name).keys()].map((u) => new Request(ORIGIN + u)),
    delete: async (req) => cacheFor(name).delete(keyOf(req)),
  });

  const caches = {
    // Cache Storage is disk-backed. Resolving it on the microtask queue (as a
    // bare `async` would) lets a deferred clone sneak in before the browser
    // touches the body, which hides the very race this suite exists to catch.
    // A macrotask is the faithful model.
    open: (name) => new Promise((r) => setTimeout(() => r(cacheApi(name)), 0)),
    keys: async () => [...store.keys()],
    delete: async (name) => store.delete(name),
    match: async (req) => {
      for (const c of store.values()) { const hit = c.get(keyOf(req)); if (hit) return hit; }
      return undefined;
    },
  };

  const fetchImpl = async (req) => {
    const u = keyOf(req);
    netLog.push(u);
    const r = network(u);
    if (!r) throw new TypeError('NetworkError');
    return r;
  };

  const self = {
    addEventListener: (t, fn) => listeners.set(t, fn),
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: ORIGIN },
  };

  const src = readFileSync(SW_PATH, 'utf8');
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', src)(
    self, caches, fetchImpl, Response, Request, URL
  );

  return { listeners, store, netLog, caches };
}

/** Run the real install -> activate lifecycle before any fetch, as a browser does. */
async function bootWorker(opts) {
  const w = loadWorker(opts);
  for (const phase of ['install', 'activate']) {
    const fn = w.listeners.get(phase);
    if (!fn) continue;
    let held;
    fn({ waitUntil: (p) => { held = p; } });
    if (held) await held;
  }
  return w;
}

const keyOf = (reqOrUrl) => {
  const raw = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
  return new URL(raw, ORIGIN).pathname;
};

/** Dispatch a fetch event and return whatever the worker responded with. */
async function dispatch(worker, { url, mode = 'no-cors', destination = '', method = 'GET' }) {
  const request = { url: ORIGIN + url, method, mode, destination };
  let responded;
  const event = { request, respondWith: (p) => { responded = p; } };
  await worker.listeners.get('fetch')(event);
  return responded ? await responded : undefined;
}

/** Let every queued microtask/deferred cache write settle. */
const settle = () => new Promise((r) => setTimeout(r, 5));

describe('sw.js — shell cache', () => {
  let rejections;
  const onRejection = (e) => rejections.push(e);

  beforeEach(() => { rejections = []; process.on('unhandledRejection', onRejection); });
  afterEach(() => { process.off('unhandledRejection', onRejection); });

  describe('caching a response without destroying it', () => {
    it('caches the navigation response AND still returns a readable body', async () => {
      const w = await bootWorker({ network: () => new Response('<html>fresh</html>') });

      const res = await dispatch(w, { url: '/fitness', mode: 'navigate' });

      // The browser consumes the body it was handed. This is the step that
      // made the old code throw: it cloned only AFTER this point.
      expect(await res.text()).toBe('<html>fresh</html>');
      await settle();

      const shell = [...w.store.values()].find((c) => c.has('/'));
      expect(shell, 'navigation response was never cached').toBeDefined();
      expect(await shell.get('/').text()).toBe('<html>fresh</html>');
    });

    it('does not raise an unhandled rejection while caching', async () => {
      const w = await bootWorker({ network: () => new Response('<html>fresh</html>') });
      const res = await dispatch(w, { url: '/fitness', mode: 'navigate' });
      await res.text();
      await settle();
      expect(rejections.map(String)).toEqual([]);
    });

    it('caches a subresource and leaves its body readable', async () => {
      const w = await bootWorker({ network: () => new Response('body{}') });

      const res = await dispatch(w, { url: '/assets/App-Cfv6ji5r.css', destination: 'style' });
      expect(await res.text()).toBe('body{}');
      await settle();

      const shell = [...w.store.values()].find((c) => c.has('/assets/App-Cfv6ji5r.css'));
      expect(shell, 'subresource was never cached').toBeDefined();
    });
  });

  describe('freshness policy', () => {
    it('serves a content-hashed asset from cache without re-hitting the network', async () => {
      const url = '/assets/CardGame-BDscaYCL.js';
      const w = await bootWorker({ network: () => new Response('v1') });

      await (await dispatch(w, { url, destination: 'script' })).text();
      await settle();
      const afterFirst = w.netLog.length;

      const second = await dispatch(w, { url, destination: 'script' });
      expect(await second.text()).toBe('v1');
      expect(w.netLog.length, 'hashed asset should be immutable and served from cache')
        .toBe(afterFirst);
    });

    it('REVALIDATES an unhashed asset instead of pinning it forever', async () => {
      // Icons and fonts ship at stable names (icon-192.png, fonts/…). Under a
      // blanket cache-first policy the first byte ever fetched wins for good,
      // and no amount of hard-refreshing at the kiosk dislodges it.
      const url = '/icon-192.png';
      let body = 'old';
      const w = await bootWorker({ network: () => new Response(body) });

      await (await dispatch(w, { url, destination: 'image' })).text();
      await settle();

      body = 'new';
      const second = await dispatch(w, { url, destination: 'image' });
      expect(await second.text(), 'stale unhashed asset was served from cache').toBe('new');
    });
  });

  describe('offline behaviour', () => {
    it('falls back to the cached shell when the network is down', async () => {
      let online = true;
      const w = await bootWorker({ network: (u) => (online ? new Response(`live:${u}`) : null) });

      await (await dispatch(w, { url: '/fitness', mode: 'navigate' })).text();
      await settle();

      online = false;
      const offline = await dispatch(w, { url: '/fitness', mode: 'navigate' });
      // Must be the shell captured on the last successful navigation, NOT the
      // copy frozen at install time -- which is what you get when the fetch
      // handler's cache write silently fails.
      expect(await offline.text()).toBe('live:/fitness');
    });

    it('falls back to a cached unhashed asset when the network is down', async () => {
      let online = true;
      const w = await bootWorker({ network: () => (online ? new Response('icon-bytes') : null) });

      await (await dispatch(w, { url: '/icon-192.png', destination: 'image' })).text();
      await settle();

      online = false;
      const offline = await dispatch(w, { url: '/icon-192.png', destination: 'image' });
      expect(await offline.text()).toBe('icon-bytes');
    });
  });

  describe('scope', () => {
    it('ignores API and media requests entirely', async () => {
      const w = await bootWorker({ network: () => new Response('nope') });
      expect(await dispatch(w, { url: '/api/v1/fitness', destination: 'script' })).toBeUndefined();
      expect(await dispatch(w, { url: '/media/clip.mp4', destination: 'video' })).toBeUndefined();
      expect(w.netLog).toEqual([]);
    });

    it('ignores non-GET requests', async () => {
      const w = await bootWorker({ network: () => new Response('nope') });
      expect(await dispatch(w, { url: '/', method: 'POST', mode: 'navigate' })).toBeUndefined();
    });
  });
});
