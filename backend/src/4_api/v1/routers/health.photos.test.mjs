import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import express from 'express';
import request from 'supertest';
import { createHealthRouter } from './health.mjs';
import { PhotoStore } from '#adapters/persistence/PhotoStore.mjs';

function makeApp({ photoStore = null } = {}) {
  const healthOperations = { defaultUsername: () => 'testuser' };
  const router = createHealthRouter({
    healthOperations,
    photoStore,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const app = express();
  app.use('/api/v1/health', router);
  return app;
}

/** A minimal stand-in for PhotoStore's own resolvePath contract, backed by a
 * real temp-dir fixture file, so this router test proves the WIRING (guard →
 * 404, valid ref → real bytes streamed) without re-testing PhotoStore's own
 * containment logic (covered in PhotoStore.test.mjs). */
function fixturePhotoStore(dir) {
  const PATTERN = /^ph_[A-Za-z0-9]+$/;
  return {
    resolvePath(userId, photoRef) {
      if (!PATTERN.test(photoRef || '')) return null;
      const p = path.join(dir, `${photoRef}.jpg`);
      return fs.existsSync(p) ? p : null;
    },
  };
}

describe('GET /api/v1/health/nutrition/photos/:photoRef', () => {
  it('serves a stored fixture with image/jpeg content-type', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    const bytes = Buffer.from('fake jpeg bytes for this fixture');
    fs.writeFileSync(path.join(dir, 'ph_realfixture123.jpg'), bytes);

    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_realfixture123');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  });

  it('404s when no photoStore is configured', async () => {
    const app = makeApp({ photoStore: null });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_whatever123');
    expect(res.status).toBe(404);
  });

  it('404s for a well-formed but never-saved ref', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_doesnotexist12345');
    expect(res.status).toBe(404);
  });

  it('rejects ../../../etc/passwd style traversal with 404, never a file read', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    // Plant a decoy just outside the photo dir to prove it is never reached.
    fs.writeFileSync(path.join(os.tmpdir(), 'passwd'), 'root:x:0:0');
    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/..%2F..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(404);
  });

  it('rejects a ref with an embedded traversal segment: ph_../../secret', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_..%2F..%2Fsecret');
    expect(res.status).toBe(404);
  });

  it('rejects a percent-encoded traversal form (%2e%2e%2f)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_%2e%2e%2f%2e%2e%2fsecret');
    expect(res.status).toBe(404);
  });

  it('404s on an empty ref (route does not even match past the segment, or 404s cleanly)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-'));
    const app = makeApp({ photoStore: fixturePhotoStore(dir) });
    const res = await request(app).get('/api/v1/health/nutrition/photos/');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/health/nutrition/photos/:photoRef — end-to-end with the real PhotoStore adapter', () => {
  function makeRealApp() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-e2e-'));
    const dataService = { user: { resolveDir: (rel, userId) => path.join(dataDir, 'users', userId, rel) } };
    const photoStore = new PhotoStore({ dataService, logger: { warn() {}, info() {}, debug() {} } });
    return { app: makeApp({ photoStore }), photoStore };
  }

  it('a photo saved for the default username round-trips through the route', async () => {
    const { app, photoStore } = makeRealApp();
    const bytes = Buffer.from('genuine round-trip bytes');
    const photoRef = await photoStore.save('testuser', bytes);

    const res = await request(app).get(`/api/v1/health/nutrition/photos/${photoRef}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(Buffer.compare(res.body, bytes)).toBe(0);
  });

  it('real PhotoStore + router together still refuse traversal', async () => {
    const { app, photoStore } = makeRealApp();
    await photoStore.save('testuser', Buffer.from('irrelevant'));

    const attempts = [
      '/api/v1/health/nutrition/photos/..%2F..%2F..%2Fetc%2Fpasswd',
      '/api/v1/health/nutrition/photos/ph_..%2F..%2Fsecret',
      '/api/v1/health/nutrition/photos/ph_%2e%2e%2f%2e%2e%2fsecret',
    ];
    for (const url of attempts) {
      const res = await request(app).get(url);
      expect(res.status).toBe(404);
    }
  });

  // SECURITY (review fix, round 2): `?userId=` must be completely inert. The
  // route always resolves the household default (getDefaultUsername() ->
  // 'testuser' in this test harness) regardless of what the query string
  // says — there is no legitimate caller for it (grep finds no frontend
  // reference to this parameter), and honoring it would let the SAME
  // containment check validate against an attacker-chosen base directory,
  // defeating it. These are real-adapter tests (not the fixture store above)
  // because a fixture that doesn't accept a userId param at all would pass
  // trivially without proving anything about the route's own behavior.
  describe('userId query parameter is ignored (never trusted from the client)', () => {
    it('?userId=otheruser cannot read another household member\'s photo — a ref that only exists under otheruser 404s, it never returns otheruser\'s bytes', async () => {
      const { app, photoStore } = makeRealApp();
      const otherRef = await photoStore.save('otheruser', Buffer.from('OTHERUSER PRIVATE BYTES'));

      const res = await request(app).get(`/api/v1/health/nutrition/photos/${otherRef}?userId=otheruser`);
      // If userId were honored this would 200 with otheruser's bytes. Fixed
      // behavior: always resolves under the default ('testuser'), which
      // never saved this ref, so it 404s.
      expect(res.status).toBe(404);
    });

    it('?userId=../users/otheruser cannot reach another user\'s photo via traversal through the ignored param', async () => {
      const { app, photoStore } = makeRealApp();
      const otherRef = await photoStore.save('otheruser', Buffer.from('OTHERUSER PRIVATE BYTES 2'));

      const res = await request(app).get(
        `/api/v1/health/nutrition/photos/${otherRef}?userId=${encodeURIComponent('../users/otheruser')}`
      );
      expect(res.status).toBe(404);
    });

    it('?userId=../../outside is inert: a ref belonging to the default user still serves the DEFAULT USER\'S bytes, not a decoy planted at the traversal target', async () => {
      const { app, photoStore } = makeRealApp(); // dataDir is captured in closure below via photoStore's own dataService
      const realBytes = Buffer.from('REAL DEFAULT-USER BYTES');
      const realRef = await photoStore.save('testuser', realBytes);

      // Plant a decoy at the traversal target using the SAME ref name, so a
      // vulnerable implementation would serve THIS instead of the real file.
      // photoStore's dataService.user.resolveDir('lifelog/nutrition/photos', 'testuser')
      // is users/testuser/lifelog/nutrition/photos — '../../outside' from
      // there lands at users/testuser/outside.
      const testuserDir = photoStore.resolvePath('testuser', realRef);
      const decoyDir = path.join(path.dirname(testuserDir), '..', '..', 'outside');
      fs.mkdirSync(decoyDir, { recursive: true });
      fs.writeFileSync(path.join(decoyDir, `${realRef}.jpg`), 'DECOY BYTES FROM TRAVERSAL TARGET');

      const res = await request(app).get(
        `/api/v1/health/nutrition/photos/${realRef}?userId=${encodeURIComponent('../../outside')}`
      );
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body, realBytes)).toBe(0); // NOT the decoy
    });

    it('duplicate ?userId=a&userId=b (an array in req.query) does not 500 — the param is never read at all', async () => {
      const { app, photoStore } = makeRealApp();
      const bytes = Buffer.from('dup param bytes');
      const realRef = await photoStore.save('testuser', bytes);

      const res = await request(app).get(`/api/v1/health/nutrition/photos/${realRef}?userId=a&userId=b`);
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body, bytes)).toBe(0);
    });
  });

  // SECURITY (review fix, round 2): Content-Type must be set EXPLICITLY by
  // the route, not merely happen to agree with what Express's sendFile
  // would infer from the resolved file's extension. Proven against a real
  // PhotoStore-shaped resource whose resolved path does NOT end in .jpg —
  // if the route relied on extension-sniffing, this would come back as
  // whatever Express infers for that extension (or a default octet-stream),
  // not image/jpeg.
  it('Content-Type is forced to image/jpeg + nosniff even for a resolved path with a non-.jpg extension', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-photos-ctype-'));
    const bytes = Buffer.from('<html>not really html</html>');
    fs.writeFileSync(path.join(dir, 'ph_wrongext123.html'), bytes);

    const misnamedStore = {
      resolvePath: (userId, photoRef) => path.join(dir, `${photoRef}.html`),
    };
    const app = makeApp({ photoStore: misnamedStore });
    const res = await request(app).get('/api/v1/health/nutrition/photos/ph_wrongext123');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/jpeg/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
