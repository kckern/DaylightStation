// @vitest-environment node
/**
 * The gated media lesson's own HTTP door — the four calls the living-room
 * screen makes, and the status codes it reads them by.
 *
 * This suite is mostly about STATUS CODES, which is unusual for a router test
 * and deliberate here. Task 8 found `schoolLifecycle.mjs` answering a REFUSED
 * completion with `200 {released:false}` because its outcome table defaults
 * anything unlisted to 200 — and the client on the other end of this router is
 * a TV in front of a child who did not answer the questions. So every status
 * the use cases can produce is asserted by number, an unmapped one must never
 * come back as a success, and the two refusals that matter most
 * (`not_playing` on an answer, `checkpoints_outstanding` on a completion) have
 * a test each whose whole job is to fail if somebody maps them to 200.
 *
 * The fixtures are the real four-unit maths course, gated the same way
 * `RecordCheckpointAnswer.test.mjs` gates it: a `checkpoints:` block laid over
 * `math-fractions.01`, so the questions graded here are real prompts with real
 * answers.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { RecordCheckpointAnswer } from '#apps/school/usecases/RecordCheckpointAnswer.mjs';
import { RecordMediaCompletion } from '#apps/school/usecases/RecordMediaCompletion.mjs';
import { ReadLessonSnapshot } from '#apps/school/usecases/ReadLessonSnapshot.mjs';
import { FakeCatalog, FakeSessionRepository, fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, MEDIA_BANK_ID, fixtureBank,
} from '#testlib/school/lifecycleFixtures.mjs';
import { createMediaLessonRouter } from '../../../../backend/src/4_api/v1/routers/mediaLesson.mjs';
import { LessonPositionReporter } from '#apps/events/RealtimePublications.mjs';

const SID = 'ses_1';
const LEARNER = 'test-user';

/** cp-120 asks one question; cp-300 asks two. Ids are `cp-<at>`. */
const CHECKPOINTS = [
  { at: 120, items: ['u1-q1'] },
  { at: 300, items: ['u1-q2', 'u1-q3'] },
];

const BANK = fixtureBank(MEDIA_BANK_ID);
const answerOf = (itemId) => BANK.items.find((i) => i.id === itemId).answer;

const bankReader = () => ({
  getBank(id) {
    if (id !== BANK.id) throw new Error(`bank '${id}' not found`);
    return structuredClone(BANK);
  },
});

let clock, sessions, curriculum, broadcasts, app;

function build({
  checkpoints = CHECKPOINTS,
  resolveLearner = (id) => ({ id, name: 'Test Learner' }),
  eventBus,
  overrides = {},
} = {}) {
  clock = fakeClock();
  broadcasts = [];
  const units = checkpoints ? rawUnits({ [MEDIA_UNIT]: { checkpoints } }) : rawUnits();
  const catalog = new FakeCatalog({ units, documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  const bus = eventBus ?? { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) };

  app = express();
  app.use(express.json());
  app.use('/api/v1/school/lesson', createMediaLessonRouter({
    readLessonSnapshot: new ReadLessonSnapshot({
      curriculum, sessions, bankReader: bankReader(), logger: silentLogger,
    }),
    recordCheckpointAnswer: new RecordCheckpointAnswer({
      curriculum, sessions, bankReader: bankReader(), clock: clock.now, logger: silentLogger,
    }),
    recordMediaCompletion: new RecordMediaCompletion({
      curriculum, sessions, clock: clock.now, logger: silentLogger,
    }),
    positionReporter: new LessonPositionReporter({
      publish: bus?.broadcast?.bind(bus),
      now: () => new Date(clock.iso()),
    }),
    resolveLearner,
    logger: silentLogger,
    ...overrides,
  }));
  return app;
}

/** A session on the gated unit, playing unless told otherwise. */
async function openSession({ playing = true, sessionId = SID, learnerId = LEARNER } = {}) {
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId, unitId: MEDIA_UNIT });
  if (playing) {
    await sessions.appendEvent(sessionId, {
      type: 'media_dispatched', at: clock.iso(), sessionId,
      dispatchId: 'disp_1', target: 'livingroom-tv', contentId: 'plex:481203',
    });
  }
  return sessionId;
}

/** Clear a checkpoint THROUGH the router, the way the screen does. */
async function clearCheckpoint(checkpointId, itemIds) {
  for (const itemId of itemIds) {
    // eslint-disable-next-line no-await-in-loop
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId, itemId, given: answerOf(itemId) });
    expect(res.status).toBe(200);
  }
}

// NOT `() => build()`: vitest treats a FUNCTION returned from a hook as a
// teardown callback, and an express app is a function — it would be invoked
// with no request after every test.
beforeEach(() => { build(); });

// ---------------------------------------------------------------------------
describe('GET /:sessionId — the snapshot the widget opens on', () => {
  it('answers the lesson, its checkpoints and who it belongs to', async () => {
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      sessionId: SID,
      contentId: 'plex:481203',
      title: 'Equivalent Fractions and Common Denominators',
      learner: { id: LEARNER, name: 'Test Learner' },
      cleared: [],
      resumePosition: null,
      seekCeiling: 120,
    });
    expect(res.body.checkpoints.map((cp) => [cp.id, cp.at]))
      .toEqual([['cp-120', 120], ['cp-300', 300]]);
  });

  it('ships EXACTLY these keys — the body is picked, never spread', async () => {
    // The router builds its reply key by key rather than spreading the use
    // case's result. Without this assertion a `...snapshot` would pass every
    // other test in the file while shipping whatever the reader grows next.
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(Object.keys(res.body).sort()).toEqual([
      'checkpoints', 'cleared', 'contentId', 'learner', 'playing',
      'resumePosition', 'seekCeiling', 'sessionId', 'state', 'title',
    ]);
  });

  it('carries the QUESTIONS — nothing else in this feature ever sends a prompt', async () => {
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    const [first] = res.body.checkpoints;
    expect(Object.keys(first).sort()).toEqual(['at', 'id', 'items']);
    expect(first.items).toEqual([{
      id: 'u1-q1',
      type: 'multiple_choice',
      prompt: 'Which fraction names the same amount as 1/2?',
      choices: ['3/6', '2/5', '3/5', '4/9'],
    }]);
  });

  it('reports cleared checkpoints as BARE IDS — the gate appends ids to this list', async () => {
    await openSession();
    await clearCheckpoint('cp-120', ['u1-q1']);
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.body.cleared).toEqual(['cp-120']);
    expect(res.body.seekCeiling).toBe(300);
  });

  it('resumes at the furthest checkpoint the child provably reached', async () => {
    await openSession();
    await clearCheckpoint('cp-120', ['u1-q1']);
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.body.resumePosition).toBe(120);
  });

  it('a gone session is 410 — the hook ends the lesson on it', async () => {
    const res = await request(app).get('/api/v1/school/lesson/nope');
    expect(res.status).toBe(410);
  });

  it('falls back to the learner id when no name can be resolved', async () => {
    build({ resolveLearner: null });
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body.learner).toEqual({ id: LEARNER, name: LEARNER });
  });

  it('a resolver that THROWS still answers — a blank TV is never the right answer', async () => {
    build({ resolveLearner: () => { throw new Error('directory down'); } });
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body.learner).toEqual({ id: LEARNER, name: LEARNER });
  });

  it('an ungated unit answers an EMPTY checkpoint list, never null', async () => {
    build({ checkpoints: null });
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body.checkpoints).toEqual([]);
    expect(res.body.seekCeiling).toBe(null);
  });
});

// ---------------------------------------------------------------------------
describe('GET /:sessionId — the public item projection', () => {
  /** One checkpoint per item type the bank authors, so nothing is projected untested. */
  const EVERY_TYPE = [
    { at: 60, items: ['u1-q1'] },   // multiple_choice
    { at: 120, items: ['u1-q3'] },  // short_answer  — its answer is nowhere else
    { at: 180, items: ['u1-q4'] },  // cloze
    { at: 240, items: ['u1-q5'] },  // matching      — pairs ARE the key
  ];
  const itemsAt = (body, at) => body.checkpoints.find((cp) => cp.at === at).items;

  beforeEach(() => { build({ checkpoints: EVERY_TYPE }); });

  it('withholds the answer KEY of every item type it ships', async () => {
    await openSession();
    const { body } = await request(app).get(`/api/v1/school/lesson/${SID}`);
    const shipped = body.checkpoints.flatMap((cp) => cp.items);
    expect(shipped).toHaveLength(4);
    shipped.forEach((item) => {
      // Assert on KEYS, not on text: a multiple choice's answer is necessarily
      // one of its own choices, so searching the payload for the answer STRING
      // would be a test that can never pass.
      expect(Object.keys(item)).not.toContain('answer');
      expect(Object.keys(item)).not.toContain('accept');
      expect(Object.keys(item)).not.toContain('expected');
    });
  });

  it('a short answer ships its prompt and NOTHING that could be marked against', async () => {
    await openSession();
    const { body, text } = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(itemsAt(body, 120)).toEqual([{
      id: 'u1-q3', type: 'short_answer',
      prompt: 'Rewrite 2/3 as an equivalent fraction with a denominator of 12.',
    }]);
    // `8/12` appears in no choice list, so it is a clean leak canary: if the
    // projection ever spreads the item, this is the assertion that catches it.
    expect(text).not.toContain('8/12');
    expect(text).not.toContain('8 / 12');
  });

  it('a cloze ships the prompt with its blank, and not the word that fills it', async () => {
    await openSession();
    const { body } = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(itemsAt(body, 180)).toEqual([{
      id: 'u1-q4', type: 'cloze',
      prompt: 'To add 1/3 and 1/6, first rewrite 1/3 as ___/6.',
    }]);
  });

  it('a matching item ships its LEFT column only — the rights are the key', async () => {
    await openSession();
    const { body, text } = await request(app).get(`/api/v1/school/lesson/${SID}`);
    const [item] = itemsAt(body, 240);
    expect(item.pairs).toEqual([{ left: '4/8' }, { left: '6/9' }, { left: '9/12' }, { left: '2/10' }]);
    ['1/2', '2/3', '3/4', '1/5'].forEach((right) => expect(text).not.toContain(`"${right}"`));
  });

  it('an item the bank cannot resolve stays a BARE ID — the overlay has a fault card for that', async () => {
    build({ checkpoints: [{ at: 60, items: ['u1-q1', 'ghost-item'] }] });
    await openSession();
    const { body } = await request(app).get(`/api/v1/school/lesson/${SID}`);
    // The count is preserved on purpose: dropping it would leave the child a
    // question short of what the server requires before the gate opens.
    expect(body.checkpoints[0].items).toHaveLength(2);
    expect(body.checkpoints[0].items[1]).toBe('ghost-item');
  });

  it('an unreadable bank degrades to bare ids rather than refusing to open the lesson', async () => {
    build({ overrides: {} });
    // Rebuild the snapshot reader with a bank that is gone.
    app = express();
    app.use(express.json());
    app.use('/api/v1/school/lesson', createMediaLessonRouter({
      readLessonSnapshot: new ReadLessonSnapshot({
        curriculum, sessions, bankReader: { getBank() { throw new Error('bank not found'); } }, logger: silentLogger,
      }),
      recordCheckpointAnswer: { execute: async () => ({ status: 'graded' }) },
      recordMediaCompletion: { execute: async () => ({ status: 'completed', released: true }) },
      logger: silentLogger,
    }));
    await openSession();
    const res = await request(app).get(`/api/v1/school/lesson/${SID}`);
    expect(res.status).toBe(200);
    expect(res.body.checkpoints[0].items).toEqual(['u1-q1']);
  });
});

// ---------------------------------------------------------------------------
describe('POST /:sessionId/answer — grading one question at the gate', () => {
  it('clears the checkpoint on the right answer and moves the ceiling', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: answerOf('u1-q1') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'graded', correct: true, checkpointCleared: true, seekCeiling: 300,
    });
  });

  it('a WRONG answer is a graded answer, not an HTTP error', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: '99/100' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ correct: false, checkpointCleared: false });
  });

  it('grades against the session in the PATH — a body naming another one cannot forge it', async () => {
    await openSession();
    await openSession({ sessionId: 'ses_other', learnerId: 'other-user' });
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ sessionId: 'ses_other', checkpointId: 'cp-120', itemId: 'u1-q1', given: answerOf('u1-q1') });
    expect(res.status).toBe(200);
    expect(res.body.sessionId).toBe(SID);
    expect(sessions.types(SID)).toContain('checkpoint_cleared');
    expect(sessions.types('ses_other')).not.toContain('checkpoint_cleared');
  });

  it('a session that is not playing is 409 — NOT a 200 a client would read as graded', async () => {
    await openSession({ playing: false });
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: answerOf('u1-q1') });
    expect(res.status).toBe(409);
    expect(res.body.status).toBe('not_playing');
  });

  it('a gone session is 410', async () => {
    const res = await request(app).post('/api/v1/school/lesson/nope/answer')
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(res.status).toBe(410);
  });

  it('an unknown checkpoint or item is 404', async () => {
    await openSession();
    const cp = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-999', itemId: 'u1-q1', given: '3/6' });
    expect(cp.status).toBe(404);
    const item = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q2', given: '12' });
    expect(item.status).toBe(404);
  });

  it('a malformed answer is 400 — a client fault, never a wrong answer', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: 42 });
    expect(res.status).toBe(400);
    expect(res.body.status).toBe('invalid_answer');
  });

  it('an ungated unit is 409, and an ungradable item is 422', async () => {
    build({ checkpoints: null });
    await openSession();
    const ungated = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(ungated.status).toBe(409);
    expect(ungated.body.status).toBe('not_gated');

    build({ overrides: { recordCheckpointAnswer: { execute: async () => ({ status: 'ungradable', message: 'x' }) } } });
    await openSession();
    const ungradable = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(ungradable.status).toBe(422);
  });

  it('a resent answer for a cleared checkpoint is 200 — the gate is already open', async () => {
    await openSession();
    await clearCheckpoint('cp-120', ['u1-q1']);
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: answerOf('u1-q1') });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'already_cleared', checkpointCleared: true });
  });

  it('a status this router does not know is a 500 — never a success', async () => {
    build({ overrides: { recordCheckpointAnswer: { execute: async () => ({ status: 'brand_new_refusal' }) } } });
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/answer`)
      .send({ checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
describe('POST /:sessionId/position — the playhead heartbeat', () => {
  it('reports the playhead on the school-playback topic and never errors at the screen', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/position`).send({ position: 137.5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, reported: true });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0].topic).toBe('school-playback');
    expect(broadcasts[0].payload).toMatchObject({ type: 'progress', sessionId: SID, seconds: 137.5 });
  });

  it('a playhead of 0 IS a playhead — the first heartbeat of every fresh lesson', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/position`).send({ position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.reported).toBe(true);
    expect(broadcasts[0].payload.seconds).toBe(0);
  });

  it('an absent or unusable position is not an error, and reports nothing', async () => {
    await openSession();
    for (const body of [{}, { position: null }, { position: 'later' }, { position: -3 }]) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post(`/api/v1/school/lesson/${SID}/position`).send(body);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, reported: false });
    }
    expect(broadcasts).toEqual([]);
  });

  it('a bus that throws never reaches the child — the heartbeat still answers', async () => {
    build({ eventBus: { broadcast: () => { throw new Error('bus is down'); } } });
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/position`).send({ position: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, reported: false });
  });
});

// ---------------------------------------------------------------------------
describe('POST /:sessionId/ended — the only thing that claims a lesson', () => {
  it('completes an ungated lesson and records PLAYHEAD confidence', async () => {
    build({ checkpoints: null });
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ completed: true, remaining: 0 });
    const completed = (await sessions.readEvents(SID)).find((e) => e.type === 'media_completed');
    expect(completed.verified).toBe('playhead');
  });

  it('completes a gated lesson once every checkpoint is cleared', async () => {
    await openSession();
    await clearCheckpoint('cp-120', ['u1-q1']);
    await clearCheckpoint('cp-300', ['u1-q2', 'u1-q3']);
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ completed: true, remaining: 0 });
  });

  it('REFUSES with 409 while checkpoints are outstanding — a 200 would read as finished', async () => {
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(res.status).toBe(409);
    expect(res.body.completed).toBe(false);
    expect((await sessions.readEvents(SID)).some((e) => e.type === 'media_completed')).toBe(false);
  });

  it('says HOW MANY stops are still owed, as a count, and where to rewind to', async () => {
    await openSession();
    await clearCheckpoint('cp-120', ['u1-q1']);
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(res.status).toBe(409);
    // The count is the whole point: a mapping that dropped it would answer 0,
    // and the screen would tell a child "0 questions are still waiting".
    expect(res.body.remaining).toBe(1);
    expect(res.body.seekCeiling).toBe(300);
    expect(typeof res.body.message).toBe('string');
  });

  it('a gone session is 410 whether it is unknown or uncorrelated', async () => {
    const res = await request(app).post('/api/v1/school/lesson/nope/ended').send({});
    expect(res.status).toBe(410);
  });

  it('a repeated /ended is 200 and still says completed — the screen retried its own POST', async () => {
    build({ checkpoints: null });
    await openSession();
    await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({}).expect(200);
    const again = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ completed: true, remaining: 0 });
  });

  it('a status this router does not know is a 500 — never a success', async () => {
    build({ overrides: { recordMediaCompletion: { execute: async () => ({ status: 'brand_new_refusal' }) } } });
    await openSession();
    const res = await request(app).post(`/api/v1/school/lesson/${SID}/ended`).send({});
    expect(res.status).toBe(500);
  });
});
