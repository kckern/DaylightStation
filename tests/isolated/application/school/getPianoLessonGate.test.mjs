/**
 * The kiosk hides its ENTIRE menu while this says `gated`, and asks for the
 * verdict on every learner pick — so the two properties under test are the
 * two that hurt when they are wrong:
 *
 *   1. the verdict itself (fails open, never re-derives a completion rule),
 *   2. and how often the launcher is actually consulted. Measured against
 *      prod 2026-09-01 a cold verdict cost 11.1s of Plex reads; a memo that
 *      forgets too eagerly re-pays that, and one that forgets too late tells
 *      a child they still owe a lesson they have just finished.
 *
 * The invalidation half is driven through the REAL EventBusSchoolRealtimeAdapter
 * on a fake bus, never through a hand-written port double: the topics that
 * change a piano verdict are the adapter's knowledge, and a test that retyped
 * them would keep passing after the adapter renamed one.
 */
import { describe, it, expect, vi } from 'vitest';
import { GetPianoLessonGate } from '#apps/school/usecases/GetPianoLessonGate.mjs';
import { EventBusSchoolRealtimeAdapter } from '#adapters/eventbus/EventBusSchoolRealtimeAdapter.mjs';

const COURSE = 'plex:695598';
const PROGRAM = 'piano-course';
const ENROLLED = [{ programId: PROGRAM, courseId: COURSE, subject: 'arts' }];

const OWED = {
  doneToday: false,
  nextLesson: {
    course: { id: COURSE, title: 'Reading Music' },
    unit: { id: 'plex:season:1', title: 'Unit 1', position: 1 },
    lesson: { id: 'plex:695611', title: 'Meet the Eighth Note', position: 11 },
  },
};
const DONE = { doneToday: true };

function fakeBus() {
  const subscriptions = [];
  return {
    subscriptions,
    subscribe(topic, fn) {
      const row = { topic, fn };
      subscriptions.push(row);
      return () => {
        const at = subscriptions.indexOf(row);
        if (at >= 0) subscriptions.splice(at, 1);
      };
    },
    broadcast() {},
    publish() {},
    async emit(topic, payload) {
      for (const row of [...subscriptions]) {
        if (row.topic === topic) await row.fn(payload);
      }
    },
    get topics() { return subscriptions.map((row) => row.topic); },
  };
}

/**
 * `now` is a mutable box rather than a fixed instant so a test can advance the
 * clock past the memo TTL without sleeping. The TTL itself is read off the
 * class — hard-coding 60000 here would let a future TTL change pass silently.
 */
function build({
  programs = ENROLLED,
  statuses = [OWED],
  realtime = null,
  now = { ms: Date.parse('2026-09-01T17:12:00.000Z') },
} = {}) {
  const list = [...statuses];
  const status = vi.fn(async () => {
    const next = list.length > 1 ? list.shift() : list[0];
    if (next instanceof Error) throw next;
    return next;
  });
  const assignments = { get: vi.fn(async () => ({ programs })) };
  const gate = new GetPianoLessonGate({
    assignments,
    launcher: { id: PROGRAM, status },
    realtime,
    clock: () => new Date(now.ms),
    logger: { warn() {}, info() {}, sampled() {} },
  });
  return { gate, status, assignments, now };
}

describe('GetPianoLessonGate — verdict', () => {
  it('gates an enrolled learner who still owes today\'s lesson', async () => {
    const { gate } = build();
    const result = await gate.execute({ learnerId: 'user_5' });
    expect(result).toMatchObject({
      schema: 'school.piano-lesson-gate/v1',
      learnerId: 'user_5',
      gated: true,
      reason: 'owed',
      lesson: { id: 'plex:695611', title: 'Meet the Eighth Note' },
    });
  });

  it('does not gate a discharged day', async () => {
    const { gate } = build({ statuses: [DONE] });
    expect(await gate.execute({ learnerId: 'user_5' }))
      .toMatchObject({ gated: false, reason: 'done' });
  });

  it('does not gate guest, and never reads a store for it', async () => {
    const { gate, assignments, status } = build();
    expect(await gate.execute({ learnerId: 'guest' }))
      .toMatchObject({ gated: false, reason: 'guest' });
    expect(assignments.get).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it('fails OPEN when the launcher throws', async () => {
    const { gate } = build({ statuses: [new Error('plex unreachable')] });
    expect(await gate.execute({ learnerId: 'user_5' }))
      .toMatchObject({ gated: false, reason: 'unavailable' });
  });
});

describe('GetPianoLessonGate — memo', () => {
  // Every other test in this file DERIVES these two off the class, which is
  // right — it stops a rename or a retune from quietly desynchronising the
  // suite. The cost is that a retune becomes invisible: MEMO_TTL_MS could go
  // to ten minutes and nothing above would notice. So the values themselves
  // are pinned exactly once, here, and changing one is a deliberate act with
  // a failing test attached.
  it('pins the tuning constants — a retune must be deliberate, not silent', () => {
    // 60s: long enough to collapse a kiosk's burst of picks, short enough that
    // anything no event announces (a dropped message, a hand-edited plan file,
    // the 4am study-day rollover) self-heals inside a minute. It must also
    // stay well UNDER FitnessPlayableService's 5-minute structure cache, so
    // this memo can never extend structure staleness.
    expect(GetPianoLessonGate.MEMO_TTL_MS).toBe(60_000);
    expect(GetPianoLessonGate.MEMO_TTL_MS).toBeLessThan(5 * 60_000);
    // 64: far above one household's roster, so eviction only ever touches
    // learners nobody is looking at.
    expect(GetPianoLessonGate.MEMO_MAX_ENTRIES).toBe(64);
  });

  it('answers a repeat read from memory instead of re-reading the course', async () => {
    const { gate, status } = build();
    const first = await gate.execute({ learnerId: 'user_5' });
    const second = await gate.execute({ learnerId: 'user_5' });
    expect(status).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('hands out a copy, so one caller cannot poison the next one\'s verdict', async () => {
    const { gate } = build();
    // Both halves matter: the verdict that WRITES the memo and the verdict
    // read back OUT of it are separate code paths, and either one returning
    // the stored object by reference leaks one request's edits into the next.
    const written = await gate.execute({ learnerId: 'user_5' });
    written.gated = false;
    const readBack = await gate.execute({ learnerId: 'user_5' });
    expect(readBack.gated).toBe(true);
    readBack.gated = false;
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
  });

  it('re-reads once the memo has aged past its TTL', async () => {
    const { gate, status, now } = build({ statuses: [OWED, DONE] });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    now.ms += GetPianoLessonGate.MEMO_TTL_MS;
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('keeps one learner\'s verdict out of another\'s', async () => {
    const { gate, status } = build({ statuses: [OWED, DONE] });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    expect((await gate.execute({ learnerId: 'beth' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('NEVER memoises `unavailable` — a cached outage outlives the outage', async () => {
    const { gate, status } = build({ statuses: [new Error('plex unreachable'), OWED] });
    expect((await gate.execute({ learnerId: 'user_5' })).reason).toBe('unavailable');
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('memoises the cheap verdicts too — not-enrolled must not re-read every pick', async () => {
    const { gate, assignments } = build({ programs: [{ programId: 'flashcards' }] });
    await gate.execute({ learnerId: 'user_5' });
    await gate.execute({ learnerId: 'user_5' });
    expect(assignments.get).toHaveBeenCalledTimes(1);
  });

  it('sweeps expired entries, so eviction still evicts the OLDEST WRITE', async () => {
    // `Map.set` on a key already present does not move it to the end. Without
    // the expiry sweep, refreshing a stale entry leaves it parked at its
    // original position — and the memo then throws away its newest verdict
    // first. Two entries age out, one is refreshed, and the memo is filled to
    // exactly capacity: the refreshed one must survive, because it is now the
    // newest write rather than the oldest.
    const { gate, assignments, now } = build({ programs: [{ programId: 'flashcards' }] });
    await gate.execute({ learnerId: 'user_5' });
    await gate.execute({ learnerId: 'beth' });
    now.ms += GetPianoLessonGate.MEMO_TTL_MS;
    await gate.execute({ learnerId: 'user_5' });
    for (let i = 0; i < GetPianoLessonGate.MEMO_MAX_ENTRIES - 1; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await gate.execute({ learnerId: `fresh-${i}` });
    }
    const before = assignments.get.mock.calls.length;
    await gate.execute({ learnerId: 'user_5' });
    expect(assignments.get.mock.calls.length).toBe(before);
  });

  it('is bounded: a flood of unknown learner ids evicts the oldest entries', async () => {
    const { gate, assignments } = build({ programs: [{ programId: 'flashcards' }] });
    await gate.execute({ learnerId: 'user_5' });
    for (let i = 0; i < GetPianoLessonGate.MEMO_MAX_ENTRIES; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await gate.execute({ learnerId: `typo-${i}` });
    }
    const before = assignments.get.mock.calls.length;
    await gate.execute({ learnerId: 'user_5' });
    expect(assignments.get.mock.calls.length).toBe(before + 1);
  });
});

describe('GetPianoLessonGate — invalidation', () => {
  const wired = (opts = {}) => {
    const bus = fakeBus();
    const ctx = build({ realtime: new EventBusSchoolRealtimeAdapter({ eventBus: bus }), ...opts });
    ctx.gate.start();
    return { ...ctx, bus };
  };

  it('subscribes to every input that can change a piano verdict', () => {
    const { bus } = wired();
    expect(bus.topics).toEqual(expect.arrayContaining([
      'piano.lesson.completed',
      'piano.school-challenge.completed',
      'school.assignments.changed',
      'school.session.outcome-recorded',
      'school',
    ]));
  });

  it('start() is idempotent', () => {
    const { bus, gate } = wired();
    const count = bus.subscriptions.length;
    gate.start();
    expect(bus.subscriptions.length).toBe(count);
  });

  it('stop() unsubscribes everything', () => {
    const { bus, gate } = wired();
    expect(bus.subscriptions.length).toBeGreaterThan(0);
    gate.stop();
    expect(bus.subscriptions.length).toBe(0);
  });

  it('drops the memo when that learner completes a piano lesson', async () => {
    const { gate, bus, status } = wired({ statuses: [OWED, DONE] });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    await bus.emit('piano.lesson.completed', { userId: 'user_5', plexId: 'plex:695611' });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('drops the memo when a grown-up bypasses the day', async () => {
    const { gate, bus, status } = wired({ statuses: [OWED, DONE] });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    await bus.emit('school', {
      event: 'program-day-bypass-changed', learnerId: 'user_5', programId: PROGRAM, active: true,
    });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('drops the memo when the learner\'s assignments change', async () => {
    const { gate, bus, status } = wired({ statuses: [OWED, DONE] });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
    await bus.emit('school.assignments.changed', { learnerId: 'user_5', at: '2026-09-01T17:13:00Z' });
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(false);
    expect(status).toHaveBeenCalledTimes(2);
  });

  it('invalidates only the learner named by the event', async () => {
    const { gate, bus, status } = wired({ statuses: [OWED] });
    await gate.execute({ learnerId: 'user_5' });
    await gate.execute({ learnerId: 'beth' });
    expect(status).toHaveBeenCalledTimes(2);
    await bus.emit('piano.lesson.completed', { userId: 'user_5', plexId: 'plex:695611' });
    await gate.execute({ learnerId: 'beth' });
    expect(status).toHaveBeenCalledTimes(2);
    await gate.execute({ learnerId: 'user_5' });
    expect(status).toHaveBeenCalledTimes(3);
  });

  it('ignores a bus event that names no learner rather than throwing', async () => {
    const { gate, bus } = wired();
    await gate.execute({ learnerId: 'user_5' });
    await expect(bus.emit('piano.lesson.completed', { plexId: 'plex:695611' })).resolves.toBeUndefined();
  });

  it('constructs and answers with no realtime at all', async () => {
    const { gate } = build({ realtime: null });
    gate.start();
    gate.stop();
    expect((await gate.execute({ learnerId: 'user_5' })).gated).toBe(true);
  });
});
