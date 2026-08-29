// @vitest-environment node
//
// Follows piano.preset.test.mjs: in-memory FileIO mock, stub configService,
// express app around createPianoRouter — the ONLY router test on the current
// pianoContainer contract (see NOTE in piano.preset.test.mjs re: broken siblings).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let files = {};
vi.mock('#system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
}));

import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';
import { YamlPianoStudioDatastore } from '../../../1_adapters/piano/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../../../3_applications/piano/PianoContainer.mjs';
import { PianoConfigProjection } from '../../../1_adapters/config/ApplicationConfigProjections.mjs';

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

function app() {
  const studioDatastore = new YamlPianoStudioDatastore({ configService });
  const pianoContainer = new PianoContainer({ studioDatastore, configProjection: new PianoConfigProjection({ configService }) });
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({ pianoContainer, logger: { info() {}, error() {} } })));
  return a;
}

beforeEach(() => { files = {}; });

describe('piano practice endpoints', () => {
  it('GET returns {} for a fresh score and 400 for an unknown user', async () => {
    expect((await request(app()).get('/api/v1/piano/users/kc/practice/files-x')).body).toEqual({});
    expect((await request(app()).get('/api/v1/piano/users/nobody/practice/files-x')).status).toBe(400);
  });

  it('rejects unsafe score keys', async () => {
    expect((await request(app()).get('/api/v1/piano/users/kc/practice/Bad.Key')).status).toBe(400);
    expect((await request(app()).put('/api/v1/piano/users/kc/practice/a/b').send({})).status).toBe(404); // slash = different route
  });

  it('PUT merges measures per-key and stamps updatedAt', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 0: { rh: { attempts: 1, passes: 1 } } } });
    const r2 = await request(a).put('/api/v1/piano/users/kc/practice/files-x')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 1: { rh: { attempts: 1, passes: 0 } } } });
    expect(Object.keys(r2.body.measures)).toEqual(['0', '1']);   // merged, not replaced
    expect(r2.body.updatedAt).toBeTruthy();
    expect(files['/data/users/kc/apps/piano/practice/files-x']).toBeTruthy();
  });

  it('PUT merges polish per-bucket', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { rh: { full: 95 } } });
    const r = await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { both: { slow: 70 } } });
    expect(r.body.polish.rh.full).toBe(95);
    expect(r.body.polish.both.slow).toBe(70);
  });

  it('PUT merges multiple tiers within the SAME polish bucket across successive PUTs', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { rh: { full: 95 } } });
    const r = await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { rh: { medium: 80 } } });
    expect(r.body.polish.rh.full).toBe(95);
    expect(r.body.polish.rh.medium).toBe(80);
  });

  it('a polish patch carrying an own "__proto__" key does not wipe existing buckets or pollute the prototype', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { rh: { full: 95 } } });
    // Sent as raw JSON text (not a JS object literal — `{ __proto__: x }` as a
    // *non-computed* literal key sets the [[Prototype]] slot at construction
    // time rather than creating an own property, which would defeat the repro).
    // express.json() -> JSON.parse gives the server an own data property
    // literally named "__proto__"; bracket assignment on it must not be
    // allowed to swap the target object's prototype.
    const r = await request(a).put('/api/v1/piano/users/kc/practice/files-x')
      .set('Content-Type', 'application/json')
      .send('{"polish":{"__proto__":{"full":99}}}');
    expect(r.status).toBe(200);
    expect(r.body.polish.rh.full).toBe(95); // existing bucket survives, not wiped
    expect(Object.prototype.hasOwnProperty.call(r.body.polish, '__proto__')).toBe(false);
    expect(r.body.polish.__proto__).not.toEqual({ full: 99 });
    const persisted = files['/data/users/kc/apps/piano/practice/files-x'];
    expect(persisted.polish.rh.full).toBe(95);
    expect(Object.prototype.hasOwnProperty.call(persisted.polish, '__proto__')).toBe(false);
  });

  it('a changed fingerprint REPLACES the record', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-y')
      .send({ fingerprint: { measureCount: 8, xmlBytes: 100 }, measures: { 0: { rh: { attempts: 3, passes: 3 } } } });
    const r = await request(a).put('/api/v1/piano/users/kc/practice/files-y')
      .send({ fingerprint: { measureCount: 9, xmlBytes: 101 }, measures: { 2: { rh: { attempts: 1, passes: 0 } } } });
    expect(r.body.measures['0']).toBeUndefined();  // stale measures discarded
    expect(r.body.measures['2']).toBeTruthy();
  });

  it('uses the v2 content digest when equal-size engravings differ', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-z')
      .send({ fingerprint: { version: 2, measureCount: 8, xmlBytes: 100, contentSha256: 'a'.repeat(64) }, measures: { 0: { rh: { attempts: 3, passes: 3 } } } });
    const r = await request(a).put('/api/v1/piano/users/kc/practice/files-z')
      .send({ fingerprint: { version: 2, measureCount: 8, xmlBytes: 100, contentSha256: 'b'.repeat(64) }, measures: { 2: { rh: { attempts: 1, passes: 0 } } } });
    expect(r.body.measures['0']).toBeUndefined();
    expect(r.body.measures['2']).toBeTruthy();
  });
});
