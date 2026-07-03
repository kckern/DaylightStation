import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPianoRouter } from '../../../backend/src/4_api/v1/routers/piano.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, app;

// Minimal per-family valid bodies. `author` is supplied per-test so the
// household-pool author-tagging can be exercised independently.
const bodies = {
  loops: {
    kind: 'groove',
    notes: [{ t: 0, type: 'note_on', note: 60, velocity: 90 }],
    ppq: 480,
    lengthBars: 4,
  },
  crate: {
    kind: 'stack',
    layers: [{ ref: 'library:brush-kit', voice: 'drums' }],
    lengthBars: 4,
  },
  songs: {
    sections: [{ id: 'a', name: 'Verse' }],
    arrangement: ['a', 'a'],
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
    // createPianoRouter touches getMediaDir() at construction (lessons root).
    getMediaDir: () => path.join(tmp, 'media'),
  };
  app = express();
  app.use(express.json());
  app.use('/piano', createPianoRouter({ configService, logger: noop }));
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

      const read = await request(app).get(`${base}/${id}`);
      expect(read.status).toBe(200);
      expect(read.body[heavyField[family]]).toEqual(bodies[family][heavyField[family]]);

      const list = await request(app).get(base);
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);
      const light = list.body.items[0];
      expect(light).toMatchObject({ id, author: 'ann' });
      expect(light.created).toBeTruthy();
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
