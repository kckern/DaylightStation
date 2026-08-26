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
import { ReadingSessionService } from '#apps/school/ReadingSessionService.mjs';
import { RecordStoryRead } from '#apps/school/usecases/RecordStoryRead.mjs';
import { createReadingRouter } from '../../../../backend/src/4_api/v1/routers/reading.mjs';

const silent = { warn() {}, info() {}, error() {}, debug() {} };

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
  };
}

function build({
  readingLog = memoryReadingLog(),
  sessions = new ReadingSessionService({ logger: silent }),
  storyTime = {
    studyDay: () => '2026-08-26',
    status: async () => ({ error: false, enrolled: true, count: 1, target: 2, progressLabel: '1 of 2 stories' }),
  },
  resolveLearner = (id) => ({ id, name: 'Learner C' }),
} = {}) {
  const broadcasts = [];
  const recordStoryRead = new RecordStoryRead({
    readingLog,
    studyDay: () => storyTime.studyDay(),
    eventBus: { broadcast: (topic, payload) => broadcasts.push({ topic, payload }) },
    clock: () => new Date('2026-08-26T18:00:00.000Z'),
    logger: silent,
  });
  const app = express();
  app.use(express.json());
  app.use('/api/v1/school/reading', createReadingRouter({
    recordStoryRead, sessions, storyTime, readingLog, resolveLearner, logger: silent,
  }));
  return { app, sessions, readingLog, broadcasts };
}

describe('POST /read — the read is recorded on completion', () => {
  it('writes one row and answers with it', async () => {
    const { app, readingLog } = build();
    const res = await request(app).post('/api/v1/school/reading/read').send({
      learnerId: 'learner-c', contentId: 'plex:620681', title: 'Frog and Toad',
      location: 'livingroom', pickId: 'pick-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.read).toMatchObject({ learnerId: 'learner-c', title: 'Frog and Toad', pickId: 'pick-1' });
    expect(await readingLog.listForDay('learner-c', '2026-08-26')).toHaveLength(1);
  });

  it('the SAME pickId twice is one read — a player that fires ended twice does not credit two books', async () => {
    const { app, readingLog } = build();
    const body = { learnerId: 'learner-c', contentId: 'plex:620681', title: 'Frog and Toad', pickId: 'pick-1' };
    await request(app).post('/api/v1/school/reading/read').send(body).expect(200);
    await request(app).post('/api/v1/school/reading/read').send(body).expect(200);
    expect(await readingLog.listForDay('learner-c', '2026-08-26')).toHaveLength(1);
  });

  it('a DIFFERENT pickId for the same book is a second read — repeats count', async () => {
    const { app, readingLog } = build();
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'learner-c', contentId: 'plex:620681', pickId: 'pick-1' }).expect(200);
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'learner-c', contentId: 'plex:620681', pickId: 'pick-2' }).expect(200);
    expect(await readingLog.listForDay('learner-c', '2026-08-26')).toHaveLength(2);
  });

  it('credits the learner the CALLER names, not whoever is at the reader now', async () => {
    // D4: a card tapped mid-story swaps the context; the story keeps the credit
    // it was picked with. The screen carries that attribution, so the route must
    // take it from the body and never re-read the session.
    const { app, readingLog, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-d' });
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'learner-c', contentId: 'plex:620681', location: 'livingroom', pickId: 'p' }).expect(200);
    expect(await readingLog.listForDay('learner-d', '2026-08-26')).toHaveLength(0);
    expect(await readingLog.listForDay('learner-c', '2026-08-26')).toHaveLength(1);
  });

  it('broadcasts story-read so the ceremony can fire', async () => {
    const { app, broadcasts } = build();
    await request(app).post('/api/v1/school/reading/read')
      .send({ learnerId: 'learner-c', contentId: 'plex:620681', title: 'Frog and Toad', pickId: 'p' }).expect(200);
    expect(broadcasts.find((b) => b.payload.event === 'story-read')).toMatchObject({
      topic: 'school', payload: { learnerId: 'learner-c', title: 'Frog and Toad' },
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
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    const res = await request(app).post('/api/v1/school/reading/playing').send({
      location: 'livingroom', learnerId: 'learner-c', contentId: 'plex:620681', pickId: 'p',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, state: 'reading' });
    expect(sessions.current('livingroom')).toMatchObject({
      state: 'reading', playing: { learnerId: 'learner-c', contentId: 'plex:620681', pickId: 'p' },
    });
  });

  it('does NOT rewrite who the session belongs to — attribution was settled at pick time', async () => {
    const { app, sessions } = build();
    sessions.open({ location: 'livingroom', learnerId: 'learner-c' });
    // A sibling wandered past between the pick and the first frame (D4).
    sessions.open({ location: 'livingroom', learnerId: 'learner-d' });
    await request(app).post('/api/v1/school/reading/playing').send({
      location: 'livingroom', learnerId: 'learner-c', contentId: 'plex:620681', pickId: 'p',
    }).expect(200);
    const session = sessions.current('livingroom');
    expect(session.learnerId).toBe('learner-d');          // the screen belongs to whoever is there
    expect(session.playing.learnerId).toBe('learner-c');  // the story keeps its credit
  });

  it('answers plainly when the session is already gone rather than erroring at a child', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/playing')
      .send({ location: 'livingroom', learnerId: 'learner-c', contentId: 'plex:1', pickId: 'p' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: false, reason: 'no-session' });
  });

  it('refuses a report that names no reader', async () => {
    const { app } = build();
    const res = await request(app).post('/api/v1/school/reading/playing').send({ learnerId: 'learner-c' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /summary — what the screen puts in front of the child', () => {
  it('answers the count and target for today, and what they read yesterday', async () => {
    const readingLog = memoryReadingLog({
      'learner-c 2026-08-25': [
        { learnerId: 'learner-c', studyDay: '2026-08-25', title: 'Corduroy', contentId: 'plex:1', at: 'x' },
        { learnerId: 'learner-c', studyDay: '2026-08-25', title: 'Blueberries', contentId: 'plex:2', at: 'y' },
      ],
    });
    const { app } = build({ readingLog });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=learner-c');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      learnerId: 'learner-c', displayName: 'Learner C',
      enrolled: true, error: false, count: 1, target: 2, progressLabel: '1 of 2 stories',
    });
    expect(res.body.yesterday.map((r) => r.title)).toEqual(['Corduroy', 'Blueberries']);
  });

  it('is still an answer when the obligation cannot be read — the child still gets to pick a book', async () => {
    const { app } = build({
      storyTime: {
        studyDay: () => '2026-08-26',
        status: async () => ({ error: true, enrolled: null, count: null, target: null }),
      },
    });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=learner-c');
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
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=learner-d');
    expect(res.body).toMatchObject({ error: false, enrolled: false, target: null });
  });

  it('yesterday being unreadable costs the child a memory, never the prompt', async () => {
    const readingLog = memoryReadingLog();
    readingLog.listForDay = async () => { throw new Error('disk gone'); };
    const { app } = build({ readingLog });
    const res = await request(app).get('/api/v1/school/reading/summary?learnerId=learner-c');
    expect(res.status).toBe(200);
    expect(res.body.yesterday).toEqual([]);
  });

  it('refuses a summary for nobody', async () => {
    const { app } = build();
    expect((await request(app).get('/api/v1/school/reading/summary')).status).toBeGreaterThanOrEqual(400);
  });
});
