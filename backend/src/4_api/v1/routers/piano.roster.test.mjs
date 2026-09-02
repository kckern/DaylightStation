// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createPianoRouter } from './piano.mjs';
import { withPianoRouterServices } from '../../../../../tests/_lib/pianoRouterDeps.mjs';
import { PianoContainer } from '#apps/piano/PianoContainer.mjs';
import { PianoConfigProjection } from '#adapters/config/ApplicationConfigProjections.mjs';

/**
 * The roster answers "who is on this piano" — and, since 2026-09-02, "which of
 * them School actually tracks".
 *
 * The piano kiosk gates Games on a learner's school day. State Gates enumerates
 * gate instances from published evidence, so a household member School has no
 * plan for produces no `piano.games` decision at all — which the kiosk read as
 * `indeterminate`, and `indeterminate` fails closed. Both grown-ups were
 * therefore permanently locked out of Games and told to go and finish
 * schoolwork they had never been assigned.
 *
 * "Not a learner" and "a learner whose day cannot be judged" are different
 * answers. The server owns the difference: who is a learner is a School fact,
 * and the browser must not be the one deciding it.
 */
const ROSTER = [
  { id: 'dad', name: 'Test User', group_label: 'Dad', birthyear: 1984 },
  { id: 'kid-one', name: 'Kid One', group_label: 'Kid One', birthyear: 2014 },
];

const silentLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const mockConfigService = {
  getUserProfile: () => null,
  getHouseholdUsers: () => ROSTER.map((u) => u.id),
  getUserDir: () => '/tmp/piano-roster-test',
  getMediaDir: () => '/tmp/piano-roster-media',
  getHouseholdAppConfig: () => ({}),
};

const mount = (schoolLearnerDirectory) => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/piano', createPianoRouter(withPianoRouterServices({
    pianoContainer: new PianoContainer({
      studioDatastore: { getRoster: () => ROSTER, isKnownUser: (id) => ROSTER.some((u) => u.id === id) },
      configProjection: new PianoConfigProjection({ configService: mockConfigService }),
      logger: silentLogger,
    }),
    schoolLearnerDirectory,
    logger: silentLogger,
  })));
  return app;
};

const byId = (users) => Object.fromEntries(users.map((u) => [u.id, u.schoolLearner]));

describe('GET /api/v1/piano/users — who School tracks', () => {
  it('marks roster members the learner directory lists, and only those', async () => {
    const app = mount({ listLearners: () => [{ id: 'kid-one' }] });

    const res = await request(app).get('/api/v1/piano/users');

    expect(res.status).toBe(200);
    expect(byId(res.body.users)).toEqual({ dad: false, 'kid-one': true });
  });

  it('resolves a directory that answers asynchronously', async () => {
    const app = mount({ listLearners: async () => [{ id: 'kid-one' }] });

    const res = await request(app).get('/api/v1/piano/users');

    expect(byId(res.body.users)).toEqual({ dad: false, 'kid-one': true });
  });

  // FAIL CLOSED, and note which direction that is. `schoolLearner: true` means
  // "gated"; the costly mistake is answering `false` for a child, which hands
  // them a games unlock by breaking School. A grown-up who has to wait for
  // School to come back is the cheap failure.
  it('gates everyone when the directory throws', async () => {
    const app = mount({ listLearners: () => { throw new Error('school is down'); } });

    const res = await request(app).get('/api/v1/piano/users');

    expect(res.status).toBe(200);
    expect(byId(res.body.users)).toEqual({ dad: true, 'kid-one': true });
  });

  it('gates everyone when School is not wired at all', async () => {
    const app = mount(null);

    const res = await request(app).get('/api/v1/piano/users');

    expect(byId(res.body.users)).toEqual({ dad: true, 'kid-one': true });
  });

  it('keeps the roster fields the kiosk already depends on', async () => {
    const app = mount({ listLearners: () => [{ id: 'kid-one' }] });

    const res = await request(app).get('/api/v1/piano/users');

    expect(res.body.users[0]).toMatchObject({ id: 'dad', name: 'Test User', group_label: 'Dad' });
  });
});
