import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPianoRouter } from '../../../backend/src/4_api/v1/routers/piano.mjs';

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, app;

const sampleEvents = [
  { t: 0, type: 'note_on', note: 60, velocity: 90 },
  { t: 500, type: 'note_off', note: 60, velocity: 0 },
];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-'));
  const configService = {
    getHouseholdPath: (rel) => path.join(tmp, rel),
  };
  app = express();
  app.use(express.json());
  app.use('/piano', createPianoRouter({ configService, logger: noop }));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('piano studio router (per-piano)', () => {
  it('POST creates a take and GET lists + reads it back, scoped to the piano', async () => {
    const create = await request(app)
      .post('/piano/living-room/studio')
      .send({ title: 'My Take', durationMs: 500, events: sampleEvents });
    expect(create.status).toBe(201);
    const { id } = create.body;
    expect(id).toBeTruthy();
    expect(create.body.pianoId).toBe('living-room');

    const list = await request(app).get('/piano/living-room/studio');
    expect(list.status).toBe(200);
    expect(list.body.takes).toHaveLength(1);
    expect(list.body.takes[0]).toMatchObject({ id, title: 'My Take', durationMs: 500, eventCount: 2 });

    const read = await request(app).get(`/piano/living-room/studio/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.events).toEqual(sampleEvents);
  });

  it('takes are isolated between pianos', async () => {
    await request(app).post('/piano/living-room/studio').send({ events: sampleEvents });
    const otherList = await request(app).get('/piano/studio-upright/studio');
    expect(otherList.body.takes).toHaveLength(0);
  });

  it('POST rejects an empty/missing events array', async () => {
    const res = await request(app).post('/piano/living-room/studio').send({ title: 'x', events: [] });
    expect(res.status).toBe(400);
  });

  it('GET returns 404 for an unknown take', async () => {
    const res = await request(app).get('/piano/living-room/studio/nope123');
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversing piano id', async () => {
    const res = await request(app).get('/piano/..%2f..%2fetc/studio');
    expect(res.status).toBe(400);
  });

  it('DELETE removes the take', async () => {
    const { body } = await request(app)
      .post('/piano/living-room/studio')
      .send({ events: sampleEvents });
    const del = await request(app).delete(`/piano/living-room/studio/${body.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true });
    const list = await request(app).get('/piano/living-room/studio');
    expect(list.body.takes).toHaveLength(0);
  });
});
