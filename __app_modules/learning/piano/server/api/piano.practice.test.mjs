// @vitest-environment node
//
// Follows piano.preset.test.mjs: in-memory FileIO mock, stub configService,
// express app around createPianoRouter — the ONLY router test on the current
// pianoContainer contract (see NOTE in piano.preset.test.mjs re: broken siblings).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

let files = {};
vi.mock('../../../../../__backend/src/0_system/utils/FileIO.mjs', () => ({
  loadYaml: (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null),
  saveYaml: (p, data) => { files[p] = data; },
  saveYamlToPathAtomic: (p, data) => { files[p.replace(/\.yml$/, '')] = data; },
  listYamlFiles: () => [],
  deleteYaml: () => false,
  ensureDir: vi.fn(),
  writeBinary: vi.fn(),
}));

import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';
import { YamlPianoStudioDatastore } from '../adapters/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../application/PianoContainer.mjs';
import { PianoConfigProjection } from "../adapters/PianoConfigProjection.mjs";

const configService = {
  getUserDir: (id) => `/data/users/${id}`,
  getUserProfile: (id) => (['kc'].includes(id) ? { id } : null),
  getHouseholdPath: (rel) => `/data/household/${rel}`,
  getHouseholdAppConfig: () => ({}),
  getMediaDir: () => '/data/media',
};

function app({ pianoPolishReward = null } = {}) {
  const studioDatastore = new YamlPianoStudioDatastore({ configService });
  const pianoContainer = new PianoContainer({ studioDatastore, configProjection: new PianoConfigProjection({ configService }) });
  const a = express();
  a.use(express.json());
  a.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({ pianoContainer, pianoPolishReward, logger: { info() {}, error() {} } })));
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

  it('PUT deep-merges Learn passages and sibling rungs', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ learn: {
      revision: 'a', passages: { 'm0-3': { rungs: { right: { passCount: 2 } } } },
    } });
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ learn: {
      revision: 'a', passages: { 'm4-7': { rungs: { left: { passCount: 1 } } } },
    } });
    const result = await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ learn: {
      revision: 'a', passages: { 'm0-3': { rungs: { together: { passCount: 3 } } } },
    } });
    expect(result.body.learn.passages).toMatchObject({
      'm0-3': { rungs: { right: { passCount: 2 }, together: { passCount: 3 } } },
      'm4-7': { rungs: { left: { passCount: 1 } } },
    });
  });

  it('PUT deep-merges Learn segment metadata without losing sibling segments', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ learn: {
      revision: 'a', segments: { 'm0-3': { fingerprint: 'one' } }, passages: { 'm0-3': { complete: true } },
    } });
    const result = await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ learn: {
      revision: 'a', segments: { 'm4-7': { fingerprint: 'two' } }, passages: { 'm4-7': { complete: false } },
    } });
    expect(result.body.learn.segments).toEqual({ 'm0-3': { fingerprint: 'one' }, 'm4-7': { fingerprint: 'two' } });
  });

  it('a changed Learn revision replaces only Learn progress', async () => {
    const a = app();
    await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({
      measures: { 0: { rh: { attempts: 1, passes: 1 } } },
      learn: { revision: 'a', passages: { old: { complete: true } } },
    });
    const result = await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({
      learn: { revision: 'b', passages: { fresh: { complete: false } } },
    });
    expect(result.body.measures['0']).toBeTruthy();
    expect(result.body.learn).toEqual({ revision: 'b', passages: { fresh: { complete: false, rungs: {} } }, segments: {} });
  });

  it('unsafe Learn passage and rung keys are ignored without prototype pollution', async () => {
    const a = app();
    const result = await request(a).put('/api/v1/piano/users/kc/practice/files-x')
      .set('Content-Type', 'application/json')
      .send('{"learn":{"revision":"a","segments":{"safe":{"fingerprint":"ok"},"__proto__":{"polluted":true}},"passages":{"safe":{"rungs":{"right":{"passCount":1},"__proto__":{"polluted":true}}},"__proto__":{"complete":true}}}}');
    expect(result.status).toBe(200);
    expect(result.body.learn.passages.safe.rungs.right.passCount).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result.body.learn.passages, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result.body.learn.passages.safe.rungs, '__proto__')).toBe(false);
    expect(result.body.learn.segments.safe.fingerprint).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(result.body.learn.segments, '__proto__')).toBe(false);
    expect({}.polluted).toBeUndefined();
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

  describe('the Polish gem and diamond a piece holds', () => {
    const holder = (held) => ({ calls: [], holdings(args) { this.calls.push(args); return held; } });

    it('GET answers them as polishAwards beside a saved record', async () => {
      const service = holder({ gem: true, diamond: false });
      const a = app({ pianoPolishReward: service });
      await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ fingerprint: { contentSha256: 'sha' } });
      const r = await request(a).get('/api/v1/piano/users/kc/practice/files-x');
      expect(r.body.polishAwards).toEqual({ gem: true, diamond: false });
      expect(service.calls[0]).toEqual({ userId: 'kc', scoreKey: 'files-x' });
    });

    it('a fresh score stays {}, and polishAwards sent back on a PUT is never stored', async () => {
      const a = app({ pianoPolishReward: holder({ gem: true, diamond: true }) });
      expect((await request(a).get('/api/v1/piano/users/kc/practice/files-x')).body).toEqual({});
      await request(a).put('/api/v1/piano/users/kc/practice/files-x').send({ fingerprint: { contentSha256: 'sha' }, polishAwards: { gem: true, diamond: true } });
      expect(files['/data/users/kc/apps/piano/practice/files-x'].polishAwards).toBeUndefined();
    });
  });

  describe('a Polish run reported with the write', () => {
    const polishRun = { scoreId: 'files:x', tempoMult: 1, metronome: true, completed: true, mixed: false, parts: [0, 1], activeParts: [0, 1], base: 97 };
    const reward = () => {
      const calls = [];
      return { calls, evaluate: (args) => { calls.push(args); return { reason: 'qualified', gem: true, diamond: true, newGem: true, newDiamond: false }; } };
    };

    it('is judged by the reward service after the save, answered, and never stored', async () => {
      const service = reward();
      const r = await request(app({ pianoPolishReward: service })).put('/api/v1/piano/users/kc/practice/files-x')
        .send({ fingerprint: { contentSha256: 'sha' }, polish: { both: { full: 97 } }, polishRun });
      expect(r.status).toBe(200);
      expect(r.body.polishReward).toEqual({ gem: true, diamond: true, newGem: true, newDiamond: false, reason: 'qualified' });
      expect(service.calls[0]).toMatchObject({ userId: 'kc', scoreKey: 'files-x', run: polishRun });
      expect(service.calls[0].record.polish.both.full).toBe(97);
      const persisted = files['/data/users/kc/apps/piano/practice/files-x'];
      expect(persisted.polishRun).toBeUndefined();
      expect(persisted.polishReward).toBeUndefined();
    });

    it('a write without a run, or with no reward service wired, answers no reward', async () => {
      const service = reward();
      const plain = await request(app({ pianoPolishReward: service })).put('/api/v1/piano/users/kc/practice/files-x').send({ polish: { both: { full: 90 } } });
      expect(plain.body.polishReward).toBeUndefined();
      expect(service.calls).toHaveLength(0);
      const unwired = await request(app()).put('/api/v1/piano/users/kc/practice/files-x').send({ polishRun });
      expect(unwired.status).toBe(200);
      expect(unwired.body.polishReward).toBeUndefined();
      expect(files['/data/users/kc/apps/piano/practice/files-x'].polishRun).toBeUndefined();
    });
  });
});
