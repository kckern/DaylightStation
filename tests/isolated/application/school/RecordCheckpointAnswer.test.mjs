/**
 * RecordCheckpointAnswer — the comprehension gate inside a playing lesson.
 *
 * The fixtures are the real four-unit maths course; the gated unit is DERIVED
 * from `math-fractions.01` (which already pairs media with a bank) by adding a
 * `checkpoints:` block, exactly as `lifecycleFixtures`' header prescribes —
 * so the items being graded here are the real prompts and real answers.
 *
 * Two rules this suite exists to hold:
 *   1. A wrong answer changes NOTHING durable and leaves the item answerable.
 *   2. A checkpoint clears only when every one of its items has been answered
 *      correctly — never on one right answer out of three.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { RecordCheckpointAnswer } from '#apps/school/usecases/RecordCheckpointAnswer.mjs';
import { CurriculumAccess } from '#apps/school/CurriculumAccess.mjs';
import { FakeCatalog, FakeSessionRepository, fakeClock, silentLogger } from '#testlib/school/lifecycleFakes.mjs';
import {
  rawUnits, rawDocuments, rawManifests, BANK_IDS, MEDIA_UNIT, MEDIA_BANK_ID, fixtureBank,
} from '#testlib/school/lifecycleFixtures.mjs';

const SID = 'ses_1';

/** cp-120 asks one question; cp-300 asks two. Both ids are `cp-<at>`. */
const CHECKPOINTS = [
  { at: 120, items: ['u1-q1'] },
  { at: 300, items: ['u1-q2', 'u1-q3'] },
];

/** The real answers, read off the bank rather than typed out. */
const BANK = fixtureBank(MEDIA_BANK_ID);
const answerOf = (itemId) => BANK.items.find((i) => i.id === itemId).answer;

let clock, sessions, curriculum, answer, bankReads;

/** Mirrors `SchoolService.getBank`: an unknown bank THROWS, it does not return null. */
const fakeBankReader = (bank = BANK) => ({
  getBank(id) {
    bankReads.push(id);
    if (id !== bank.id) throw new Error(`bank '${id}' not found`);
    return structuredClone(bank);
  },
});

const build = ({ checkpoints = CHECKPOINTS, bankReader = fakeBankReader() } = {}) => {
  clock = fakeClock();
  bankReads = [];
  const units = checkpoints ? rawUnits({ [MEDIA_UNIT]: { checkpoints } }) : rawUnits();
  const catalog = new FakeCatalog({ units, documents: rawDocuments(), manifests: rawManifests() });
  curriculum = new CurriculumAccess({ catalog, bankIds: () => BANK_IDS, clock: clock.epoch, logger: silentLogger });
  sessions = new FakeSessionRepository();
  answer = new RecordCheckpointAnswer({ curriculum, sessions, bankReader, clock: clock.now, logger: silentLogger });
};

/** A session in whatever state the test needs, on the gated unit. */
const openSession = async ({ playing = true, stalled = false, sessionId = SID, learnerId = 'kid1' } = {}) => {
  await sessions.appendEvent(sessionId, { type: 'created', at: clock.iso(), sessionId, learnerId, unitId: MEDIA_UNIT });
  if (playing) {
    await sessions.appendEvent(sessionId, {
      type: 'media_dispatched', at: clock.iso(), sessionId,
      dispatchId: 'disp_1', target: 'living-room-tv', contentId: 'plex:481203',
    });
  }
  if (stalled) await sessions.appendEvent(sessionId, { type: 'media_stalled', at: clock.iso(), sessionId, reason: 'test' });
  return sessionId;
};

const right = (itemId, sessionId = SID, checkpointId = 'cp-120') =>
  answer.execute({ sessionId, checkpointId, itemId, given: answerOf(itemId) });

beforeEach(() => build());

describe('RecordCheckpointAnswer — refusals that never crash', () => {
  it('refuses a session that is not playing, and writes nothing', async () => {
    await openSession({ playing: false });
    const result = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: answerOf('u1-q1') });
    expect(result).toMatchObject({ status: 'not_playing', correct: null, checkpointCleared: false });
    expect(typeof result.message).toBe('string');
    expect(sessions.types(SID)).toEqual(['created']);
  });

  it('refuses an unknown session', async () => {
    const result = await answer.execute({ sessionId: 'nope', checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(result.status).toBe('unknown_session');
    expect(sessions.ids()).toEqual([]);
  });

  it('refuses a unit that has no checkpoints at all', async () => {
    build({ checkpoints: null });
    await openSession();
    const result = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(result.status).toBe('not_gated');
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('refuses a checkpoint id the unit does not author', async () => {
    await openSession();
    const result = await answer.execute({ sessionId: SID, checkpointId: 'cp-999', itemId: 'u1-q1', given: '3/6' });
    expect(result.status).toBe('unknown_checkpoint');
  });

  it('refuses an item that is not one of THAT checkpoint\'s questions', async () => {
    await openSession();
    // u1-q2 is real, and is asked at cp-300 — but not here.
    const result = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q2', given: '12' });
    expect(result.status).toBe('unknown_item');
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
  });

  it('refuses (without throwing) when the bank the checkpoint needs is gone', async () => {
    build({ bankReader: { getBank() { throw new Error('bank not found'); } } });
    await openSession();
    const result = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/6' });
    expect(result.status).toBe('ungradable');
    expect(result.correct).toBe(null);
  });

  it('refuses a malformed answer shape BEFORE grading, and does not spend an attempt', async () => {
    await openSession();
    const bad = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: 42 });
    expect(bad).toMatchObject({ status: 'invalid_answer', correct: null });
    expect(typeof bad.message).toBe('string');
    // The next real answer is attempt ONE: a shape error never reached the grader.
    const wrong = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '2/5' });
    expect(wrong).toMatchObject({ correct: false, attempts: 1 });
  });
});

describe('RecordCheckpointAnswer — retry until correct', () => {
  it('leaves a wrong answer answerable, writes nothing, and counts the attempt', async () => {
    await openSession();
    const first = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '2/5' });
    expect(first).toMatchObject({ status: 'graded', correct: false, attempts: 1, checkpointCleared: false });
    const second = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '3/5' });
    expect(second).toMatchObject({ correct: false, attempts: 2 });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
    // Still answerable — and the right answer still clears it.
    const third = await right('u1-q1');
    expect(third).toMatchObject({ correct: true, checkpointCleared: true, attempts: 3 });
  });

  it('a wrong answer never moves the seek ceiling', async () => {
    await openSession();
    const wrong = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '2/5' });
    expect(wrong.seekCeiling).toBe(120);
  });
});

describe('RecordCheckpointAnswer — clearing', () => {
  it('clears a one-item checkpoint and records it durably, round-tripped through the log', async () => {
    await openSession();
    const result = await right('u1-q1');
    expect(result).toMatchObject({
      status: 'graded', correct: true, checkpointCleared: true, checkpointId: 'cp-120', seekCeiling: 300,
    });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'checkpoint_cleared']);
    // The whitelist round trip: a field dropped by createEvent would land here as undefined.
    const stored = sessions.events(SID).at(-1);
    expect(stored).toMatchObject({ type: 'checkpoint_cleared', checkpointId: 'cp-120', attempts: 1, sessionId: SID });
    expect(sessions.derive(SID).clearedCheckpoints).toEqual([
      { checkpointId: 'cp-120', attempts: 1, at: stored.at },
    ]);
    // A clear is an ANNOTATION: the lesson is still playing.
    expect(sessions.derive(SID).state).toBe('media_dispatched');
  });

  it('does NOT clear a multi-item checkpoint on one right answer of two', async () => {
    await openSession();
    const first = await right('u1-q2', SID, 'cp-300');
    // cp-120 is still uncleared, so the ceiling is 120 — the ceiling is a
    // property of the work OWED, not of the checkpoint being answered.
    expect(first).toMatchObject({ correct: true, checkpointCleared: false, seekCeiling: 120 });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
    const second = await right('u1-q3', SID, 'cp-300');
    expect(second).toMatchObject({ correct: true, checkpointCleared: true, seekCeiling: 120 });
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-300', attempts: 2 }]);
  });

  it('records every answer the checkpoint cost, wrong ones included', async () => {
    await openSession();
    await answer.execute({ sessionId: SID, checkpointId: 'cp-300', itemId: 'u1-q2', given: '6' });
    await answer.execute({ sessionId: SID, checkpointId: 'cp-300', itemId: 'u1-q2', given: '10' });
    const q2 = await right('u1-q2', SID, 'cp-300');
    expect(q2).toMatchObject({ correct: true, attempts: 3, checkpointCleared: false });
    // A fresh item is on attempt one even while the checkpoint is on its fourth answer.
    const q3 = await right('u1-q3', SID, 'cp-300');
    expect(q3).toMatchObject({ correct: true, attempts: 1, checkpointCleared: true });
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-300', attempts: 4 }]);
  });

  it('reports the ITEM\'s attempts on a partial clear, not the checkpoint\'s running total', async () => {
    await openSession();
    await answer.execute({ sessionId: SID, checkpointId: 'cp-300', itemId: 'u1-q3', given: 'nope' });
    await answer.execute({ sessionId: SID, checkpointId: 'cp-300', itemId: 'u1-q3', given: 'still nope' });
    // The checkpoint is on its third answer; this ITEM is on its first.
    const q2 = await right('u1-q2', SID, 'cp-300');
    expect(q2).toMatchObject({ correct: true, checkpointCleared: false, attempts: 1 });
    // ...and the checkpoint's own total is what lands on the event.
    await right('u1-q3', SID, 'cp-300');
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-300', attempts: 4 }]);
  });

  it('reports an unclamped ceiling once every checkpoint is cleared', async () => {
    await openSession();
    await right('u1-q1');
    await right('u1-q2', SID, 'cp-300');
    const last = await right('u1-q3', SID, 'cp-300');
    expect(last).toMatchObject({ checkpointCleared: true, seekCeiling: null });
  });

  it('accepts a clear from a STALLED session — a gated lesson outlives its own media', async () => {
    await openSession({ stalled: true });
    expect(sessions.derive(SID).state).toBe('media_stalled');
    const result = await right('u1-q1');
    expect(result).toMatchObject({ status: 'graded', correct: true, checkpointCleared: true });
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-120', attempts: 1 }]);
  });

  it('answers an already-cleared checkpoint idempotently, without a second event', async () => {
    await openSession();
    await right('u1-q1');
    const again = await answer.execute({ sessionId: SID, checkpointId: 'cp-120', itemId: 'u1-q1', given: '2/5' });
    expect(again).toMatchObject({ status: 'already_cleared', checkpointCleared: true, seekCeiling: 300 });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched', 'checkpoint_cleared']);
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-120', attempts: 1 }]);
  });
});

describe('RecordCheckpointAnswer — where partial progress lives', () => {
  it('keeps two learners\' partial checkpoints apart', async () => {
    await openSession();
    await openSession({ sessionId: 'ses_2', learnerId: 'kid2' });
    await right('u1-q2', SID, 'cp-300');
    // The other session answered only ONE of the two — its checkpoint must not clear.
    const other = await right('u1-q3', 'ses_2', 'cp-300');
    expect(other).toMatchObject({ correct: true, checkpointCleared: false });
    expect(sessions.types('ses_2')).toEqual(['created', 'media_dispatched']);
  });

  it('re-asks a half-answered checkpoint after a restart, rather than clearing it early', async () => {
    await openSession();
    await right('u1-q2', SID, 'cp-300');
    // A new instance is a restarted process: in-memory progress is gone.
    answer = new RecordCheckpointAnswer({ curriculum, sessions, bankReader: fakeBankReader(), clock: clock.now, logger: silentLogger });
    const after = await right('u1-q3', SID, 'cp-300');
    expect(after).toMatchObject({ correct: true, checkpointCleared: false });
    expect(sessions.types(SID)).toEqual(['created', 'media_dispatched']);
    // Answering both again clears it — the child is never stranded.
    await right('u1-q2', SID, 'cp-300');
    expect(sessions.derive(SID).clearedCheckpoints).toMatchObject([{ checkpointId: 'cp-300' }]);
  });

  it('does not grow its progress table without bound', async () => {
    const over = RecordCheckpointAnswer.MAX_TRACKED_CHECKPOINTS + 50;
    for (let i = 0; i < over; i += 1) {
      const sid = `ses_bulk_${i}`;
      // eslint-disable-next-line no-await-in-loop
      await openSession({ sessionId: sid, learnerId: `kid_${i}` });
      // eslint-disable-next-line no-await-in-loop
      await right('u1-q2', sid, 'cp-300');
    }
    expect(answer.trackedCheckpointCount()).toBeLessThanOrEqual(RecordCheckpointAnswer.MAX_TRACKED_CHECKPOINTS);
    // Eviction takes the OLDEST: the newest session still remembers its half.
    const newest = `ses_bulk_${over - 1}`;
    const finish = await right('u1-q3', newest, 'cp-300');
    expect(finish).toMatchObject({ correct: true, checkpointCleared: true });
  });

  it('forgets a checkpoint nobody came back to, rather than holding it forever', async () => {
    await openSession();
    await right('u1-q2', SID, 'cp-300');
    clock.advanceHours(9);
    const after = await right('u1-q3', SID, 'cp-300');
    expect(after).toMatchObject({ correct: true, checkpointCleared: false });
    expect(answer.trackedCheckpointCount()).toBe(1);
  });
});
