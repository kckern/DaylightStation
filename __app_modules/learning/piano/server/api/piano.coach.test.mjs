// @vitest-environment node
import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';
import { pianoCoachFixture } from '../../../../../tests/_lib/pianoCoachFixture.mjs';
import { PianoLearnCoachService } from '../application/PianoLearnCoachService.mjs';

describe('piano coaching API', () => {
  const setup = () => {
    const f = pianoCoachFixture();const app = express();app.use(express.json());
    app.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
      pianoContainer: { studioDatastore: f.datastore }, pianoLearnCoachService: new PianoLearnCoachService(f), logger: f.logger,
    })));
    app.use((error, req, res, next) => { res.status(error.status ?? 500).json({ error: error.message }); });
    return { app, f };
  };
  it('acknowledges valid events and offers profile-scoped resumed state', async () => {
    const { app, f } = setup();const url = '/api/v1/piano/users/learner4/practice/files-test-musicxml/coach';
    const first = await request(app).post(url).send(f.outcome('attempt-one'));
    expect(first.status).toBe(200);expect(first.body.revision).toBe(1);
    expect((await request(app).get(url)).body.state.evidence).toHaveLength(1);
    expect((await request(app).post(url).send(f.outcome('attempt-one'))).body.duplicate).toBe(true);
  });
  it('returns validation errors rather than silently writing under a different profile', async () => {
    const { app, f } = setup();
    const result = await request(app).post('/api/v1/piano/users/learner5/practice/files-test-musicxml/coach').send(f.outcome('attempt-one'));
    expect(result.status).toBe(400);expect(f.records.size).toBe(0);
    expect((await request(app).get('/api/v1/piano/users/unknown/practice/files-test/coach')).status).toBe(400);
  });
  it('does not let a legacy practice PUT overwrite the acknowledged coaching state', async () => {
    const { app, f } = setup();const url = '/api/v1/piano/users/learner4/practice/files-test-musicxml';
    await request(app).post(`${url}/coach`).send(f.outcome('attempt-one'));
    await request(app).put(url).send({ fingerprint: { contentSha256: 'changed' }, learnCoach: { revision: 999 } });
    expect((await request(app).get(`${url}/coach`)).body.revision).toBe(1);
  });
});
