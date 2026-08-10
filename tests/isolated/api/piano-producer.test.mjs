import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPianoRouter } from '../../../backend/src/4_api/v1/routers/piano.mjs';
import { YamlPianoStudioDatastore } from '../../../backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../../../backend/src/3_applications/piano/PianoContainer.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, app, studioDatastore;

// Minimal per-family valid bodies. `author` is supplied per-test so the
// household-pool author-tagging can be exercised independently.
const bodies = {
  loops: {
    kind: 'groove',
    notes: [{ ticks: 0, durationTicks: 480, midi: 36, velocity: 90 }],
    ppq: 480,
    lengthBars: 4,
  },
  crate: {
    kind: 'stack',
    layers: [{
      id: 'brush-kit', role: 'groove', channel: 9, gmProgram: null, gain: 1,
      muted: false, soloed: false, carried: false,
      source: { kind: 'library', entry: { path: 'percussion/brush-kit.musicxml' } },
    }],
    lengthBars: 4,
  },
  songs: {
    sections: [{ id: 'a', name: 'Verse', lengthBars: 4, stack: [] }],
    arrangement: [{ sectionId: 'a', repeats: 2 }],
    carriedLayers: {},
    meta: { keyShift: 0, bpm: 96 },
  },
};

// The top-level payload field the light listing must NOT echo back.
const heavyField = { loops: 'notes', crate: 'layers', songs: 'sections' };

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-producer-'));
  const configService = {
    // Household-scoped resolver — mirrors ConfigService.getHouseholdPath.
    getHouseholdPath: (rel) => path.join(tmp, rel),
    getMediaDir: () => path.join(tmp, 'media'),
    getHouseholdAppConfig: () => ({}),
    getUserProfile: () => null,
  };
  // Persistence + the two course algorithms live in the container now; the
  // router is thin and takes only the container.
  studioDatastore = new YamlPianoStudioDatastore({ configService, logger: noop });
  const pianoContainer = new PianoContainer({ studioDatastore, configService, logger: noop });
  app = express();
  app.use(express.json());
  app.use('/piano', createPianoRouter({ pianoContainer, logger: noop }));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

for (const family of ['loops', 'crate', 'songs']) {
  describe(`piano producer /${family} (household pool)`, () => {
    const base = `/piano/producer/${family}`;
    const body = () => ({ ...bodies[family], author: 'ann' });

    it('lists empty before anything is saved', async () => {
      const res = await request(app).get(base);
      expect(res.status).toBe(200);
      expect(res.body.items).toEqual([]);
    });

    it('POST creates, GET :id reads full, GET list is light', async () => {
      const create = await request(app).post(base).send(body());
      expect(create.status).toBe(201);
      const { id } = create.body;
      expect(id).toBeTruthy();
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(create.body.author).toBe('ann');
      expect(create.body.created).toBeTruthy();
      expect(create.body.schemaVersion).toBe(2);
      expect(create.body.revision).toBe(1);
      expect(create.body.title).toBeTruthy();
      expect(create.body.contentHash).toMatch(/^[a-f0-9]{64}$/);

      const read = await request(app).get(`${base}/${id}`);
      expect(read.status).toBe(200);
      expect(read.body[heavyField[family]]).toEqual(bodies[family][heavyField[family]]);

      const list = await request(app).get(base);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      const light = list.body.items[0];
      expect(light).toMatchObject({ id, author: 'ann' });
      expect(light.created).toBeTruthy();
      expect(light.schemaVersion).toBe(2);
      // Light listing must NOT carry the heavy note/layer/section payload.
      expect(light[heavyField[family]]).toBeUndefined();
    });

    it('PATCH updates title (and favorite) and it is reflected', async () => {
      const { body: created } = await request(app).post(base).send(body());
      const patch = await request(app)
        .patch(`${base}/${created.id}`)
        .send({ title: 'Renamed', favorite: true });
      expect(patch.status).toBe(200);
      expect(patch.body).toMatchObject({ id: created.id, title: 'Renamed', favorite: true });
      expect(patch.body.revision).toBe(2);

      const read = await request(app).get(`${base}/${created.id}`);
      expect(read.body.title).toBe('Renamed');
      expect(read.body.favorite).toBe(true);
    });

    it('DELETE removes the record (subsequent GET 404s)', async () => {
      const { body: created } = await request(app).post(base).send(body());
      const del = await request(app).delete(`${base}/${created.id}`);
      expect(del.status).toBe(200);
      expect(del.body).toMatchObject({ ok: true, id: created.id });

      const read = await request(app).get(`${base}/${created.id}`);
      expect(read.status).toBe(404);
    });

    it('POST without author → 400', async () => {
      const { author, ...noAuthor } = body();
      const res = await request(app).post(base).send(noAuthor);
      expect(res.status).toBe(400);
    });

    it(`POST missing required field (${heavyField[family]}) → 400`, async () => {
      const b = body();
      delete b[heavyField[family]];
      const res = await request(app).post(base).send(b);
      expect(res.status).toBe(400);
    });

    it('rejects ids with a dot, uppercase, or slash → 400', async () => {
      for (const bad of ['has.dot', 'Upper', 'a%2Fb']) {
        const res = await request(app).get(`${base}/${bad}`);
        expect(res.status).toBe(400);
      }
    });

    it('GET :id → 404 for an unknown id', async () => {
      const res = await request(app).get(`${base}/nope123`);
      expect(res.status).toBe(404);
    });
  });
}

describe('piano producer — unknown family', () => {
  it('returns 404 for a family outside {loops,crate,songs}', async () => {
    const res = await request(app).get('/piano/producer/bogus');
    expect(res.status).toBe(404);
  });
});

describe('piano producer — production persistence contract', () => {
  it('quarantines corrupt stored data in lists and rejects direct reads', async () => {
    const valid = await request(app).post('/piano/producer/loops').send({
      ...bodies.loops, author: 'ann', title: 'Healthy loop', sourceTakeId: 'healthy-take',
    });
    expect(valid.status).toBe(201);
    const corruptId = 'corrupt-loop';
    studioDatastore.saveProducer('loops', corruptId, {
      ...valid.body,
      id: corruptId,
      title: 'Broken loop',
      notes: [{ ...valid.body.notes[0], midi: 999 }],
      // Deliberately leave the prior hash in place: both the impossible note
      // and the content-integrity mismatch must be detected on a raw read.
    });

    const list = await request(app).get('/piano/producer/loops');
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({ id: valid.body.id })]);
    expect(list.body.invalidRecords).toEqual([{
      id: corruptId,
      errors: expect.arrayContaining([
        expect.stringContaining('contentHash does not match'),
        expect.stringContaining('midi must be 0..127'),
      ]),
    }]);

    const read = await request(app).get(`/piano/producer/loops/${corruptId}`);
    expect(read.status).toBe(422);
    expect(read.body).toMatchObject({
      code: 'PRODUCER_RECORD_INVALID', id: corruptId,
    });
  });

  it('treats a reference to a corrupt loop as invalid instead of merely present', async () => {
    const loop = await request(app).post('/piano/producer/loops').send({
      ...bodies.loops, author: 'ann', sourceTakeId: 'referenced-take',
    });
    const crate = await request(app).post('/piano/producer/crate').send({
      author: 'ann', kind: 'stack', lengthBars: 4,
      layers: [{
        id: 'recorded-bass', role: 'bass', channel: 1, gmProgram: 33, gain: 1,
        muted: false, soloed: false, carried: false,
        source: { kind: 'loop', loopId: loop.body.id },
      }],
    });
    expect(crate.status).toBe(201);

    studioDatastore.saveProducer('loops', loop.body.id, {
      ...loop.body,
      notes: [{ ...loop.body.notes[0], durationTicks: 0 }],
    });

    const list = await request(app).get('/piano/producer/crate');
    expect(list.body.items).toEqual([]);
    expect(list.body.invalidRecords).toEqual([expect.objectContaining({ id: crate.body.id })]);
    const read = await request(app).get(`/piano/producer/crate/${crate.body.id}`);
    expect(read.status).toBe(422);
    expect(read.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('loopId missing')]));
  });

  it('dedupes repeat saves of the same captured take', async () => {
    const payload = { ...bodies.loops, author: 'ann', sourceTakeId: 'take-uuid-1' };
    const first = await request(app).post('/piano/producer/loops').send(payload);
    const second = await request(app).post('/piano/producer/loops').send(payload);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['x-producer-deduped']).toBe('true');
    expect(second.body.id).toBe(first.body.id);
    expect((await request(app).get('/piano/producer/loops')).body.items).toHaveLength(1);
  });

  it('rejects a stale update revision', async () => {
    const created = await request(app).post('/piano/producer/songs').send({ ...bodies.songs, author: 'ann' });
    const update = await request(app).patch(`/piano/producer/songs/${created.body.id}`)
      .send({ title: 'First update', expectedRevision: 1 });
    expect(update.status).toBe(200);
    const stale = await request(app).patch(`/piano/producer/songs/${created.body.id}`)
      .send({ title: 'Lost update', expectedRevision: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.current).toBe(2);
  });

  it('rejects dead loop references on writes', async () => {
    const badCrate = {
      author: 'ann', kind: 'stack', lengthBars: 4,
      layers: [{
        id: 'gone', role: 'melody', channel: 0, gmProgram: 0, gain: 1,
        muted: false, soloed: false, carried: false,
        source: { kind: 'loop', loopId: 'gone' },
      }],
    };
    const res = await request(app).post('/piano/producer/crate').send(badCrate);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('loopId missing');
  });
});

describe('piano producer — household author-tagging (not per-user filtered)', () => {
  it('two authors both appear in the shared household list', async () => {
    await request(app).post('/piano/producer/loops').send({ ...bodies.loops, author: 'ann' });
    await request(app).post('/piano/producer/loops').send({ ...bodies.loops, author: 'bob' });

    const list = await request(app).get('/piano/producer/loops');
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    const authors = list.body.items.map((i) => i.author).sort();
    expect(authors).toEqual(['ann', 'bob']);
  });
});
