import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';
import { IconManifestStore } from '#adapters/persistence/IconManifestStore.mjs';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

function makeApp({ iconManifestStore = null } = {}) {
  const router = createHealthRouter({
    healthOperations: { defaultUsername: () => 'testuser' },
    iconManifestStore,
    logger: silent,
  });
  const app = express();
  app.use('/api/v1/health', router);
  return app;
}

/**
 * A REAL IconManifestStore over a real temp media tree — not a stand-in. The
 * traversal assertions below are only worth anything if the thing under test
 * is the adapter that will actually resolve paths in production.
 */
function realStore({ extraIcons = {}, files = [], absoluteEscape = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'health-icons-route-'));
  const mediaRoot = path.join(root, 'media');
  const all = ['img/nutrition/icons/vegetables/carrot.png', 'img/icons/food/apple_sauce.png', ...files];
  for (const rel of all) {
    const full = path.join(mediaRoot, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `PNG-BYTES-FOR ${rel}`);
  }
  // A decoy OUTSIDE the media root, so a successful escape would be visible
  // as bytes rather than merely as a status code.
  fs.writeFileSync(path.join(root, 'secret.png'), 'ROOT:X:0:0 SECRET BYTES');
  const doc = {
    icons: {
      carrot: { path: 'img/nutrition/icons/vegetables/carrot.png' },
      // An ABSOLUTE path to a real .png outside the media root. It has to be a
      // .png: an absolute path with no image extension is refused by the
      // extension allowlist alone, which would let the containment check rot
      // undetected.
      ...(absoluteEscape ? { escape: { path: path.join(root, 'secret.png') } } : {}),
      ...extraIcons,
    },
    aliases: { apple_sauce: { path: 'img/icons/food/apple_sauce.png' } },
  };
  const store = new IconManifestStore({
    dataService: { household: { read: () => doc } }, mediaRoot, logger: silent,
  });
  return { root, mediaRoot, store };
}

describe('GET /api/v1/health/nutrition/icons/:slug', () => {
  it('serves the manifest-named bytes with an image content-type', async () => {
    const { mediaRoot, store } = realStore();
    const app = makeApp({ iconManifestStore: store });
    const res = await request(app).get('/api/v1/health/nutrition/icons/carrot');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const expected = fs.readFileSync(path.join(mediaRoot, 'img/nutrition/icons/vegetables/carrot.png'));
    expect(Buffer.compare(res.body, expected)).toBe(0);
  });

  it('serves a legacy alias slug, so stored FoodItem.icon values keep working', async () => {
    const { store } = realStore();
    const app = makeApp({ iconManifestStore: store });
    const res = await request(app).get('/api/v1/health/nutrition/icons/apple_sauce');
    expect(res.status).toBe(200);
  });

  it('sends a long, immutable cache header (an icon file never changes under its slug)', async () => {
    const { store } = realStore();
    const app = makeApp({ iconManifestStore: store });
    const res = await request(app).get('/api/v1/health/nutrition/icons/carrot');
    expect(res.headers['cache-control']).toMatch(/max-age=\d{6,}/);
    expect(res.headers['cache-control']).toMatch(/immutable/);
  });

  it('404s when no icon manifest store is configured at all', async () => {
    const app = makeApp({ iconManifestStore: null });
    const res = await request(app).get('/api/v1/health/nutrition/icons/carrot');
    expect(res.status).toBe(404);
  });

  it('404s for a well-formed slug that the manifest does not know', async () => {
    const { store } = realStore();
    const app = makeApp({ iconManifestStore: store });
    const res = await request(app).get('/api/v1/health/nutrition/icons/nosuchicon');
    expect(res.status).toBe(404);
  });

  it('404s when the manifest names a file that is not on disk', async () => {
    const { store } = realStore({ extraIcons: { ghost: { path: 'img/nutrition/icons/gone/ghost.png' } } });
    const app = makeApp({ iconManifestStore: store });
    const res = await request(app).get('/api/v1/health/nutrition/icons/ghost');
    expect(res.status).toBe(404);
  });

  describe('the slug is user-controlled and joined against a filesystem root, so escape must be impossible', () => {
    // Each attempt is asserted on BOTH the status AND the body: a 200 carrying
    // the decoy's bytes is the failure this exists to catch, and a status-only
    // assertion could miss a route that streamed a file under a 404.
    const attempts = [
      '..%2F..%2F..%2Fetc%2Fpasswd',
      '..%2Fsecret',
      '%2e%2e%2f%2e%2e%2fsecret',
      '%2e%2e%2fsecret.png',
      '%2Fetc%2Fpasswd',
      'carrot%2F..%2F..%2Fsecret',
      'carrot%00.png',
      '....%2F%2F..%2Fsecret',
      'carrot.png',
      '%2e%2e%5c%2e%2e%5csecret',
    ];
    for (const attempt of attempts) {
      it(`refuses ${attempt} with 404 and no file bytes`, async () => {
        const { store } = realStore();
        const app = makeApp({ iconManifestStore: store });
        const res = await request(app).get(`/api/v1/health/nutrition/icons/${attempt}`);
        expect(res.status).toBe(404);
        expect(String(res.text || res.body || '')).not.toMatch(/SECRET BYTES/);
      });
    }

    // The route's OWN allowlist, proven independently of the adapter's. Every
    // test above would still pass if the route check were deleted, because the
    // real store refuses the same slugs — so those tests cannot tell whether
    // the HTTP boundary is guarded at all. This one can: it hands the route a
    // deliberately naive store that joins whatever it is given onto a
    // directory, which is exactly what the boundary check exists to protect
    // against when a future store is written or an existing one is loosened.
    it('the ROUTE refuses a traversal slug before any store sees it, even a store that would happily serve it', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-icons-naive-'));
      fs.writeFileSync(path.join(path.dirname(dir), 'naive-secret.png'), 'NAIVE SECRET BYTES');
      let sawSlug = null;
      const naiveStore = {
        resolve(slug) {
          sawSlug = slug;
          const p = path.join(dir, `${slug}.png`);
          return fs.existsSync(p) ? { slug, absolutePath: p, contentType: 'image/png' } : null;
        },
      };
      const app = makeApp({ iconManifestStore: naiveStore });
      const res = await request(app).get(
        `/api/v1/health/nutrition/icons/${encodeURIComponent('../' + path.basename(dir) + '/../naive-secret')}`,
      );
      expect(res.status).toBe(404);
      expect(String(res.text || res.body || '')).not.toMatch(/NAIVE SECRET BYTES/);
      // The decisive assertion: the store was never consulted at all.
      expect(sawSlug).toBeNull();
    });

    it('a doubly-encoded traversal is refused too', async () => {
      const { store } = realStore();
      const app = makeApp({ iconManifestStore: store });
      const res = await request(app).get('/api/v1/health/nutrition/icons/%252e%252e%252fsecret');
      expect(res.status).toBe(404);
    });

    it('a manifest entry that itself points outside the media root is refused', async () => {
      const { store } = realStore({ extraIcons: { escape: { path: '../secret.png' } } });
      const app = makeApp({ iconManifestStore: store });
      const res = await request(app).get('/api/v1/health/nutrition/icons/escape');
      expect(res.status).toBe(404);
      expect(String(res.text || res.body || '')).not.toMatch(/SECRET BYTES/);
    });

    it('a manifest entry naming an absolute path to a real image outside the root is refused', async () => {
      const { store } = realStore({ absoluteEscape: true });
      const app = makeApp({ iconManifestStore: store });
      const res = await request(app).get('/api/v1/health/nutrition/icons/escape');
      expect(res.status).toBe(404);
      expect(String(res.text || res.body || '')).not.toMatch(/SECRET BYTES/);
    });
  });
});
