// @vitest-environment node
/**
 * The living-room reading session's own HTTP door — three routes, one story.
 *
 * `POST /playing` is the one the state machine cannot work without: nothing
 * else moves a session to `reading`, and until it does, D5's mid-story branch
 * never fires and EVERY book tapped during a story is claimed as if it were a
 * fresh prompt.
 *
 * `POST /read` is the only path that writes evidence, and the `pickId` dedup
 * around it is the single most likely field bug in the whole plan set: a
 * player that fires `ended` twice, or a screen that remounts mid-book, must
 * not credit two books.
 */
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { ReadingSessionService as ProductionReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { RecordStoryRead } from '#apps/school/usecases/RecordStoryRead.mjs';
import { ReadingApiService } from '#apps/school/ReadingApiService.mjs';
import { createReadingRouter } from '../../../../backend/src/4_api/v1/routers/reading.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };
const TEST_SCHEDULER = { withDeadline: (work) => work, every: () => () => {}, wait: async () => {} };
class ReadingSessionService extends ProductionReadingSessionService {
  constructor(config = {}) { super({ scheduler: TEST_SCHEDULER, ...config }); }
}

/** The `append` contract from IReadingLogStore, in memory: idempotent on pickId. */
function memoryReadingLog(seed = {}) {
  const days = new Map(Object.entries(seed));
  return {
    days,
    async append(row) {
      const key = `${row.learnerId} ${row.studyDay}`;
      const rows = days.get(key) ?? [];
      const existing = row.pickId ? rows.find((r) => r.pickId === row.pickId) : null;
      if (existing) return existing;
      rows.push(row);
      days.set(key, rows);
      return row;
    },
    async listForDay(learnerId, studyDay) {
      return days.get(`${learnerId} ${studyDay}`) ?? [];
    },
    async findByPickId(learnerId, studyDay, pickId) {
      return (days.get(`${learnerId} ${studyDay}`) ?? []).find(row => row.pickId === pickId) ?? null;
    },
  };
}

function build({
  readingLog = memoryReadingLog(),
  sessions = new ReadingSessionService({ logger: silent }),
  storyTime = {
    studyDay: () => '2026-08-26',
    status: async () => ({ error: false, enrolled: true, count: 1, target: 2, progressLabel: '1 of 2 stories' }),
  },
  resolveLearner = (id) => ({ id, name: 'User_5' }),
  observationStore = null,
} = {}) {
  const broadcasts = [];
  const recordStoryRead = new RecordStoryRead({
    readingLog,
    studyDay: () => storyTime.studyDay(),
    realtime: { storyReadRecorded: (payload) => broadcasts.push({ topic: 'school', payload: { event: 'story-read', ...payload } }) },
    clock: () => new Date('2026-08-26T18:00:00.000Z'),
    logger: silent,
  });
  const app = express();
  app.use(express.json());
  const readingService = new ReadingApiService({
    recordStoryRead, sessions, storyTime, readingLog, resolveLearner, observationStore, logger: silent,
  });
  app.use('/api/v1/school/reading', createReadingRouter({ readingService }));
  return { app, sessions, readingLog, broadcasts };
}

describe('GET /events — live reading-session observability', () => {
  it('reports the open session, its ages, and its bounded transition timeline', async () => {
    const { app, sessions } = build();
    const session = sessions.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = sessions.activate('livingroom', session.sessionId);
    sessions.acknowledge('livingroom', presenting.pendingPresentation);
    const res = await request(app).get('/api/v1/school/reading/events?location=livingroom&limit=2');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ location: 'livingroom', session: { sessionId: session.sessionId, learnerId: 'user_5' } });
    expect(res.body.ageMs).toEqual(expect.any(Number));
    expect(res.body.ackAgeMs).toEqual(expect.any(Number));
    expect(res.body.events).toHaveLength(2);
    expect(res.body.events.at(-1)).toMatchObject({ type: 'presentation-acknowledged', sessionId: session.sessionId });
  });

  it('prefers the durable observation capability and preserves age/state fields', async () => {
    const observationStore = {
      list: async () => [{ type: 'opened', state: 'prompt', at: '2026-08-26T17:59:59.000Z' }],
    };
    const { app, sessions } = build({ observationStore });
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    const res = await request(app).get('/api/v1/school/reading/events?location=livingroom&limit=1');
    expect(res.body).toMatchObject({ visibleState: 'prompt', displayedSince: '2026-08-26T17:59:59.000Z' });
    expect(res.body).toHaveProperty('ageMs');
    expect(res.body.ackAgeMs).toEqual(expect.any(Number));
    expect(res.body).toHaveProperty('progressAgeMs', null);
  });
});

describe('session, acknowledgement, progress, and read-status routes', () => {
  it('returns and acknowledges the authoritative location snapshot', async () => {
    const { app, sessions } = build();
    const opened = sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    const snapshot = await request(app).get('/api/v1/school/reading/session?location=livingroom');
    expect(snapshot.body).toMatchObject({ location: 'livingroom', session: { sessionId: opened.sessionId } });
    const ack = await request(app).post('/api/v1/school/reading/session/ack')
      .send({ location: ' livingroom ', sessionId: ` ${opened.sessionId} ` });
    expect(ack.body).toMatchObject({ ok: true, session: { sessionId: opened.sessionId } });
  });

  it('commits only an exact rendered-presentation acknowledgement', async () => {
    const { app, sessions } = build();
    const reserved = sessions.open({ location: 'livingroom', learnerId: 'user_5', state: 'starting' });
    const presenting = sessions.activate('livingroom', reserved.sessionId);
    const proof = presenting.pendingPresentation;

    await request(app).post('/api/v1/school/reading/session/ack')
      .send({ location: 'livingroom', ...proof, revision: proof.revision - 1 })
      .expect(409, { ok: false, reason: 'stale-presentation' });
    expect(sessions.current('livingroom').state).toBe('presenting');

    const ack = await request(app).post('/api/v1/school/reading/session/ack')
      .send({ location: 'livingroom', ...proof })
      .expect(200);
    expect(ack.body).toMatchObject({
      ok: true,
      session: { learnerId: 'user_5', sessionId: proof.sessionId, state: 'prompt' },
    });
  });

  it('updates progress and preserves numeric coercion and timestamp fields', async () => {
    const { app, sessions } = build();
    const opened = sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.update('livingroom', { pick: { pickId: 'pick-1', learnerId: 'user_5', contentId: 'plex:1' } });
    const res = await request(app).post('/api/v1/school/reading/progress').send({
      location: 'livingroom', sessionId: opened.sessionId, pickId: 'pick-1',
      positionSec: '12.5', durationSec: '90', paused: true,
    });
    expect(res.body).toMatchObject({ ok: true, session: { progress: {
      positionSec: 12.5, durationSec: 90, paused: true,
    } } });
    expect(res.body.session.progress.at).toEqual(expect.any(String));
  });

  it('returns the established conflict and read-status envelopes', async () => {
    const readingLog = memoryReadingLog({
      'user_5 2026-08-26': [{ learnerId: 'user_5', studyDay: '2026-08-26', pickId: 'pick-1' }],
    });
    const { app } = build({ readingLog });
    expect((await request(app).post('/api/v1/school/reading/progress').send({})).body)
      .toEqual({ ok: false, reason: 'session-or-pick-mismatch' });
    expect((await request(app).get('/api/v1/school/reading/read-status?learnerId=user_5&studyDay=2026-08-26&pickId=pick-1')).body)
      .toEqual({ recorded: true, read: { learnerId: 'user_5', studyDay: '2026-08-26', pickId: 'pick-1' } });
  });
});

describe('POST /read — the read is recorded on completion', () => {
  it('writes one row and answers with it', async () => {
    const { app, readingLog } = build();
    const res = await request(app).post('/api/v1/school/reading/read').send({
      learnerId: 'user_5', contentId: 'plex:620681', title: 'Frog and Toad',
      location: 'livingroom', pickId: 'pick-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.read).toMatchObject({ learnerId: 'user_5', title: 'Frog and Toad', pickId: 'pick-1' });
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
  });

  it('the SAME pickId twice is one read — a player that fires ended twice does not credit two books', async () => {
    const { app, readingLog } = build();
    const body = { learnerId: 'user_5', contentId: 'plex:620681', title: 'Frog and Toad', pickId: 'pick-1' };
    await request(app).post('/api/v1/school/reading/read').send(body).expect(200);
    await request(app).post('/api/v1/school/reading/read').send(body).expect(200);
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
  });

  it('a DIFFERENT pickId for the same book is a second read — repeats count', async () => {
    const { app, readingLog } = build();
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'user_5', contentId: 'plex:620681', pickId: 'pick-1' }).expect(200);
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'user_5', contentId: 'plex:620681', pickId: 'pick-2' }).expect(200);
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(2);
  });

  it('records the incident-shaped learner-a/Three Little Pigs completion against its frozen server pick', async () => {
    const { app, readingLog, sessions } = build();
    const opened = sessions.open({ location: 'livingroom', learnerId: 'learner-a' });
    sessions.update('livingroom', {
      state: 'reading',
      pick: {
        learnerId: 'learner-a', contentId: 'plex:620707', pickId: 'pick_mtku4ebd_2',
        studyDay: '2026-09-02',
      },
      playing: { learnerId: 'learner-a', contentId: 'plex:620707', pickId: 'pick_mtku4ebd_2' },
    });

    const response = await request(app).post('/api/v1/school/reading/read').send({
      learnerId: 'learner-a', contentId: 'plex:620707', title: 'The Three Little Pigs',
      location: 'livingroom', sessionId: opened.sessionId, pickId: 'pick_mtku4ebd_2',
    }).expect(200);

    expect(response.body).toMatchObject({ recorded: true, read: { learnerId: 'learner-a', pickId: 'pick_mtku4ebd_2' } });
    expect(await readingLog.listForDay('learner-a', '2026-09-02')).toEqual([
      expect.objectContaining({
        learnerId: 'learner-a', contentId: 'plex:620707', pickId: 'pick_mtku4ebd_2',
      }),
    ]);
  });

  it('credits the learner the CALLER names, not whoever is at the reader now', async () => {
    // Legacy/repair callers may not carry a server-side pick. Their explicit
    // learner remains the evidence owner; an unrelated prompt cannot steal it.
    const { app, readingLog, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_3' });
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'user_5', contentId: 'plex:620681', location: 'livingroom', pickId: 'p' }).expect(200);
    expect(await readingLog.listForDay('user_3', '2026-08-26')).toHaveLength(0);
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
  });

  it('broadcasts story-read so the ceremony can fire', async () => {
    const { app, broadcasts } = build();
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'user_5', contentId: 'plex:620681', title: 'Frog and Toad', pickId: 'p' }).expect(200);
    expect(broadcasts.find((b) => b.payload.event === 'story-read')).toMatchObject({
      topic: 'school', payload: { learnerId: 'user_5', title: 'Frog and Toad' },
    });
  });

  it('refuses a read with no learner rather than filing it under nobody', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/read').send({ contentId: 'plex:1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('POST /playing — nothing else moves a session to READING', () => {
  it('moves the open session to reading', async () => {
    const { app, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    const res = await request(app).post('/api/v1/school/reading/playing').send({
      location: 'livingroom', learnerId: 'user_5', contentId: 'plex:620681', pickId: 'p',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, state: 'reading' });
    expect(sessions.current('livingroom')).toMatchObject({
      state: 'reading', playing: { learnerId: 'user_5', contentId: 'plex:620681', pickId: 'p' },
    });
  });

  it('does NOT rewrite who the session belongs to — attribution was settled at pick time', async () => {
    const { app, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    // The card workflow now forbids this transition. Keep the API defensive
    // against a legacy or direct caller that bypasses that workflow.
    sessions.open({ location: 'livingroom', learnerId: 'user_3' });
    await request(app).post('/api/v1/school/reading/playing').send({
      location: 'livingroom', learnerId: 'user_5', contentId: 'plex:620681', pickId: 'p',
    }).expect(200);
    const session = sessions.current('livingroom');
    expect(session.learnerId).toBe('user_3');          // the screen belongs to whoever is there
    expect(session.playing.learnerId).toBe('user_5');  // the story keeps its credit
  });

  it('answers plainly when the session is already gone rather than erroring at a child', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/playing')
      .send({ location: 'livingroom', learnerId: 'user_5', contentId: 'plex:1', pickId: 'p' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it('refuses a report that names no reader', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/playing').send({ learnerId: 'user_5' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /summary — what the screen puts in front of the child', () => {
  it('answers the count, yesterday, and recent history newest first', async () => {
    const readingLog = memoryReadingLog({
      'user_5 2026-08-25': [
        { learnerId: 'user_5', studyDay: '2026-08-25', title: 'Corduroy', contentId: 'plex:1', at: 'x' },
        { learnerId: 'user_5', studyDay: '2026-08-25', title: 'Blueberries', contentId: 'plex:2', at: 'y' },
      ],
    });
    const { app } = build({ readingLog });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=user_5');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      learnerId: 'user_5', displayName: 'User_5',
      enrolled: true, error: false, count: 1, target: 2, progressLabel: '1 of 2 stories',
    });
    expect(res.body.yesterday.map((r) => r.title)).toEqual(['Corduroy', 'Blueberries']);
    expect(res.body.recent.map((r) => r.title)).toEqual(['Blueberries', 'Corduroy']);
    expect(res.body.recent[0]).toMatchObject({ studyDay: '2026-08-25' });
  });

  it('is still an answer when the obligation cannot be read — the child still gets to pick a book', async () => {
    const { app } = build({
      storyTime: {
        studyDay: () => '2026-08-26',
        status: async () => ({ error: true, enrolled: null, count: null, target: null }),
      },
    });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=user_5');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ error: true, count: null, target: null });
  });

  it('a learner with no enrollment is not an error, and is owed nothing', async () => {
    const { app } = build({
      storyTime: {
        studyDay: () => '2026-08-26',
        status: async () => ({ error: false, enrolled: false, count: null, target: null }),
      },
    });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=user_3');
    expect(res.body).toMatchObject({ error: false, enrolled: false, target: null });
  });

  it('yesterday being unreadable costs the child a memory, never the prompt', async () => {
    const readingLog = memoryReadingLog();
    readingLog.listForDay = async () => { throw new Error('disk gone'); };
    const { app } = build({ readingLog });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=user_5');
    expect(res.status).toBe(200);
    expect(res.body.yesterday).toEqual([]);
    expect(res.body.recent).toEqual([]);
  });

  it('refuses a summary for nobody', async () => {
    const { app } = build();
    expect((await request(app).get('/api/v1/school/reading/summary')).status).toBeGreaterThanOrEqual(400);
  });
});

/**
 * `READING --ended--> RETURNING --rendered face--> PROMPT` (§5). Completion
 * clears the pick immediately, but the launch card is not switchable until the
 * TV proves the learner's face is visible again.
 *
 * Two things break while a finished session sits at `reading`. The next book
 * tapped is evaluated by D5's mid-story branch, so in assignment mode it is
 * refused with "finish this one first" when nothing is playing at all. And the
 * idle timeout (D6) exempts `reading` on purpose — a long audiobook is not an
 * empty room — so the session never expires and the TV that D8 stopped from
 * powering itself off stays on all night. The teardown D6 promises depends on
 * this transition existing.
 */
describe('POST /read — and the session it leaves behind', () => {
  const finish = (app, over = {}) => request(app).post('/api/v1/school/reading/read').send({
    learnerId: 'user_5', contentId: 'plex:1', title: 'Corduroy',
    location: 'livingroom', pickId: 'pick_1', ...over,
  });

  it('waits in returning until the launch face is acknowledged', async () => {
    const { app, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.update('livingroom', { state: 'reading', playing: { learnerId: 'user_5', pickId: 'pick_1' } });

    const response = await finish(app).expect(200);

    expect(sessions.current('livingroom')).toMatchObject({ state: 'returning', pick: null, playing: null });
    expect(response.body.presentation).toMatchObject({ learnerId: 'user_5', reason: 'return' });
    sessions.acknowledge('livingroom', response.body.presentation);
    expect(sessions.current('livingroom')).toMatchObject({ state: 'prompt', learnerId: 'user_5' });
  });

  it('and that is what lets an abandoned session time out at all (D6)', async () => {
    const { app, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_5' });
    sessions.update('livingroom', { state: 'reading' });
    await finish(app).expect(200);
    // `sweep` exempts `reading`; returning is bounded and may expire.
    expect(sessions.current('livingroom').state).toBe('returning');
  });

  it('does NOT re-credit the read to whoever the session belongs to now (D4)', async () => {
    // The card workflow now forbids a mid-story switch. This remains defense
    // in depth for legacy/direct callers: the screen's pick-time snapshot is
    // still evidence and nothing here may second-guess it.
    const { app, sessions, readingLog } = build();
    sessions.open({ location: 'livingroom', learnerId: 'user_3' });
    sessions.update('livingroom', { state: 'reading' });

    await finish(app, { learnerId: 'user_5' }).expect(200);

    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
    expect(await readingLog.listForDay('user_3', '2026-08-26')).toHaveLength(0);
    expect(sessions.current('livingroom').learnerId).toBe('user_3');
  });

  it('records the read even with no session open — the story still happened', async () => {
    const { app, readingLog } = build();
    await finish(app).expect(200);
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
  });

  it('records the read even when the body names no location', async () => {
    const { app, readingLog } = build();
    await finish(app, { location: undefined }).expect(200);
    expect(await readingLog.listForDay('user_5', '2026-08-26')).toHaveLength(1);
  });
});
