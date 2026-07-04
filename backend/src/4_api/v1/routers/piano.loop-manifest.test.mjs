// @vitest-environment node
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';

// Minimal configService stub: getMediaDir points at a dir with no brick folders,
// so getManifest returns []. We only assert the route contract + shape here.
function makeApp(mediaDir) {
  const configService = {
    getMediaDir: () => mediaDir,
    getUserProfile: () => null,
    getUserDir: () => '/tmp/none',
    getHouseholdPath: (p) => `/tmp/${p}`,
    hydrateUsers: () => [],
  };
  const app = express();
  app.use('/api/v1/piano', createPianoRouter({ configService, logger: { info() {}, error() {} } }));
  return app;
}

describe('GET /api/v1/piano/loop-manifest', () => {
  it('returns { bricks, count } (empty when no brick folders exist)', async () => {
    const app = makeApp('/tmp/does-not-exist-brick-root');
    const res = await request(app).get('/api/v1/piano/loop-manifest');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.bricks)).toBe(true);
    expect(res.body.count).toBe(res.body.bricks.length);
  });
});
