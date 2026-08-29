import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPianoRouter } from '../../../backend/src/4_api/v1/routers/piano.mjs';
import { withPianoRouterServices } from '../../_lib/pianoRouterDeps.mjs';
import { YamlPianoStudioDatastore } from '../../../backend/src/1_adapters/piano/YamlPianoStudioDatastore.mjs';
import { PianoContainer } from '../../../backend/src/3_applications/piano/PianoContainer.mjs';
import { PianoConfigProjection } from '../../../backend/src/1_adapters/config/ApplicationConfigProjections.mjs';

// NOTE: piano studio takes moved from a per-piano-device layout
// (`/piano/:pianoId/studio`) to a per-user layout (`/piano/users/:userId/studio`)
// in a0ca19028 "refactor(piano): thin the router onto PianoContainer" — the
// router doc comment at the top of piano.mjs spells out why (roster-based,
// mirrors fitness). This test was written before that refactor and never
// updated; it now targets the current per-user routes + PianoContainer DI.

const noop = { warn: () => {}, info: () => {}, debug: () => {}, error: () => {}, child: () => noop };
let tmp, app;

const users = { alice: { display_name: 'Alice' }, bob: { display_name: 'Bob' } };

const sampleEvents = [
  { t: 0, type: 'note_on', note: 60, velocity: 90 },
  { t: 500, type: 'note_off', note: 60, velocity: 0 },
];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'piano-'));
  const configService = {
    getHouseholdPath: (rel) => path.join(tmp, rel),
    getMediaDir: () => path.join(tmp, 'media'),
    getHouseholdAppConfig: () => ({}),
    getUserDir: (id) => path.join(tmp, 'users', id),
    getUserProfile: (id) => users[id] || null,
    getHouseholdUsers: () => Object.keys(users),
  };
  const studioDatastore = new YamlPianoStudioDatastore({ configService, logger: noop });
  const pianoContainer = new PianoContainer({ studioDatastore, configProjection: new PianoConfigProjection({ configService }), logger: noop });
  app = express();
  app.use(express.json());
  app.use('/piano', createPianoRouter(withPianoRouterServices({ pianoContainer, logger: noop })));
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

describe('piano studio router (per-user)', () => {
  it('POST creates a take and GET lists + reads it back, scoped to the user', async () => {
    const create = await request(app)
      .post('/piano/users/alice/studio')
      .send({ title: 'My Take', durationMs: 500, events: sampleEvents });
    expect(create.status).toBe(201);
    const { id } = create.body;
    expect(id).toBeTruthy();
    expect(create.body.userId).toBe('alice');

    const list = await request(app).get('/piano/users/alice/studio');
    expect(list.status).toBe(200);
    expect(list.body.takes).toHaveLength(1);
    expect(list.body.takes[0]).toMatchObject({ id, title: 'My Take', durationMs: 500, eventCount: 2 });

    const read = await request(app).get(`/piano/users/alice/studio/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.events).toEqual(sampleEvents);
  });

  it('takes are isolated between users', async () => {
    await request(app).post('/piano/users/alice/studio').send({ events: sampleEvents });
    const otherList = await request(app).get('/piano/users/bob/studio');
    expect(otherList.body.takes).toHaveLength(0);
  });

  it('POST rejects an empty/missing events array', async () => {
    const res = await request(app).post('/piano/users/alice/studio').send({ title: 'x', events: [] });
    expect(res.status).toBe(400);
  });

  it('GET returns 404 for an unknown take', async () => {
    const res = await request(app).get('/piano/users/alice/studio/nope123');
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversing user id', async () => {
    const res = await request(app).get('/piano/users/..%2f..%2fetc/studio');
    expect(res.status).toBe(400);
  });

  it('DELETE removes the take', async () => {
    const { body } = await request(app)
      .post('/piano/users/alice/studio')
      .send({ events: sampleEvents });
    const del = await request(app).delete(`/piano/users/alice/studio/${body.id}`);
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ ok: true });
    const list = await request(app).get('/piano/users/alice/studio');
    expect(list.body.takes).toHaveLength(0);
  });
});
