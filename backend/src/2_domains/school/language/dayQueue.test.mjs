/**
 * Day-queue tests.
 *
 * The queue is derived from the attempt log on every read. These tests exist
 * because the original 2016 app STORED it, a server migration lost the writes,
 * and a real learner's progress silently froze for weeks ("it's still on the
 * dictation set I did twice"). Every assertion below is about the derivation
 * staying faithful to the evidence.
 */
import { describe, it, expect } from 'vitest';
import { buildDayQueue, summarizeQueue } from './dayQueue.mjs';

const KOREAN = { source: 'EN', target: 'KR' };
const FULLY_EQUIPPED = { microphone: true, textInput: ['EN', 'KR'] };

const ev = (seq, rung, day) => ({ seq, rung, day });
const build = (over = {}) => buildDayQueue({
  log: [],
  day: 1,
  dailyLimit: 3,
  corpusSize: 100,
  capabilities: FULLY_EQUIPPED,
  languages: KOREAN,
  ...over,
});

/**
 * The warm-up fill (see dayQueue.mjs, "The cold start") pads a short day with
 * practice passes over its own new set. Tests about WHICH sentences are
 * admitted, and at which rung they are CREDITED, read the credited entries —
 * padding is a separate concern with its own describe block below.
 */
const credited = (queue) => queue.filter((entry) => !entry.practice);

describe('new material', () => {
  it('uses an injected ordered admission scope for new material', () => {
    const queue = credited(build({ admission: [9, 4, 2], dailyLimit: 2 }));
    expect(queue).toEqual([
      { seq: 9, rung: 'repetition', done: false },
      { seq: 4, rung: 'repetition', done: false },
    ]);
  });

  it('deduplicates overlapping admission bands after normalization', () => {
    expect(credited(build({ admission: [6, '6', 7], dailyLimit: 3 })).map((entry) => entry.seq))
      .toEqual([6, 7]);
  });

  it('treats malformed admission as an empty scope, not the whole corpus', () => {
    for (const admission of ['123', 0, {}, new Set([1, 2])]) {
      expect(build({ admission })).toEqual([]);
    }
  });

  it('does not coerce booleans into sequence numbers', () => {
    expect(build({ admission: [true, false] })).toEqual([]);
  });

  it('admits exactly dailyLimit sentences on a fresh start', () => {
    const queue = credited(build());
    expect(queue).toEqual([
      { seq: 1, rung: 'repetition', done: false },
      { seq: 2, rung: 'repetition', done: false },
      { seq: 3, rung: 'repetition', done: false },
    ]);
  });

  it('never admits past the end of the corpus', () => {
    expect(credited(build({ corpusSize: 2 }))).toHaveLength(2);
  });

  it('counts sentences started today against today\'s limit', () => {
    // Two already done today + one fresh = the limit, not limit + 2.
    const log = [ev(1, 'repetition', 5), ev(2, 'repetition', 5)];
    const queue = credited(build({ log, day: 5 }));
    expect(queue).toEqual([
      { seq: 1, rung: 'repetition', done: true },
      { seq: 2, rung: 'repetition', done: true },
      { seq: 3, rung: 'repetition', done: false },
    ]);
  });

  it('fills gaps left behind instead of stranding them past a high-water mark', () => {
    // The 2016 implementation took max(seq)+1, so a skipped sentence was lost
    // forever. Scanning in order picks seq 2 back up.
    const log = [ev(1, 'repetition', 1), ev(3, 'repetition', 1)];
    const queue = build({ log, day: 9, dailyLimit: 1 });
    expect(queue.filter((e) => e.rung === 'repetition' && !e.done))
      .toEqual([{ seq: 2, rung: 'repetition', done: false }]);
  });
});

describe('graduation', () => {
  it('promotes yesterday\'s work one rung', () => {
    const log = [ev(1, 'repetition', 1)];
    const queue = build({ log, day: 2, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'dictation', done: false }]);
  });

  it('does NOT promote the same day — one rung per day is the whole method', () => {
    // Drilled at repetition this morning must not reappear as dictation this
    // afternoon; that would collapse the ladder into a single sitting.
    const log = [ev(1, 'repetition', 1)];
    const queue = build({ log, day: 1, dailyLimit: 0 });
    expect(queue.some((e) => e.rung === 'dictation')).toBe(false);
  });

  it('marks a graduate done once cleared today, keeping it in the queue', () => {
    // Still present so the progress denominator does not shrink as work is
    // completed — a bar whose total drops reads as making no progress.
    const log = [ev(1, 'repetition', 1), ev(1, 'dictation', 2)];
    const queue = build({ log, day: 2, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'dictation', done: true }]);
  });

  it('drops a sentence that climbed past this rung on an earlier day', () => {
    const log = [ev(1, 'repetition', 1), ev(1, 'dictation', 2)];
    const queue = build({ log, day: 3, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'recording', done: false }]);
  });

  it('retires a sentence that has climbed the whole ladder', () => {
    const log = [
      ev(1, 'repetition', 1), ev(1, 'dictation', 2),
      ev(1, 'recording', 3), ev(1, 'interpretation', 4),
    ];
    expect(build({ log, day: 5, dailyLimit: 0 })).toEqual([]);
  });

  it('uses the EARLIEST clearing so a retry cannot stall the ladder', () => {
    // Re-doing repetition on day 7 must not push graduation to day 8.
    const log = [ev(1, 'repetition', 1), ev(1, 'repetition', 7)];
    const queue = build({ log, day: 7, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'dictation', done: false }]);
  });
});

describe('capability degradation', () => {
  it('graduates across a rung the device cannot perform', () => {
    const log = [ev(1, 'repetition', 1), ev(1, 'dictation', 2)];
    const noMic = { microphone: false, textInput: ['EN', 'KR'] };
    const queue = build({ log, day: 3, dailyLimit: 0, capabilities: noMic });
    // Skips `recording` entirely rather than queuing an unusable rung.
    expect(queue).toEqual([{ seq: 1, rung: 'interpretation', done: false }]);
  });

  it('never queues a rung the device cannot perform', () => {
    const log = [ev(1, 'repetition', 1)];
    const latinOnly = { microphone: false, textInput: ['EN'] };
    const queue = build({ log, day: 2, dailyLimit: 0, capabilities: latinOnly });
    expect(queue.every((e) => e.rung !== 'dictation' && e.rung !== 'recording')).toBe(true);
  });

  it('still produces new material on a device with no input at all', () => {
    const queue = build({ capabilities: {} });
    expect(queue).toHaveLength(3);
    expect(queue.every((e) => e.rung === 'repetition')).toBe(true);
  });
});

describe('undated legacy evidence', () => {
  // The 2016 database is gone, so imported recordings carry no `day` — and
  // fabricating one would put fiction in an append-only evidence log. They
  // must still count, or the whole legacy import is inert and the learner is
  // silently sent back to sentence 1.
  const legacy = (seq) => ({ seq, rung: 'recording', source: 'legacy-2017' });

  it('counts an undated event as cleared before any real day', () => {
    const queue = build({ log: [legacy(1)], day: 1, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'interpretation', done: false }]);
  });

  it('does NOT re-admit a legacy sentence as new material', () => {
    // It already climbed rep -> dict -> rec in 2016. Offering it as brand-new
    // repetition would both duplicate it in the queue and lose the progress
    // the import exists to restore.
    const queue = build({ log: [legacy(1)], day: 1, dailyLimit: 3 });
    expect(queue.filter((e) => e.seq === 1)).toEqual([
      { seq: 1, rung: 'interpretation', done: false },
    ]);
    expect(queue.filter((e) => e.rung === 'repetition').map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it('retires a legacy sentence once its final rung is cleared', () => {
    const queue = build({
      log: [legacy(1), ev(1, 'interpretation', 1)], day: 2, dailyLimit: 0,
    });
    expect(queue).toEqual([]);
  });

  it('places a whole legacy import at the right rung without duplicates', () => {
    const log = [1, 2, 3, 4, 5].map(legacy);
    const full = build({ log, day: 1, dailyLimit: 2, corpusSize: 100 });
    const queue = credited(full);
    const seqs = queue.map((e) => e.seq);
    // No sentence is credited twice. (It may reappear as a PRACTICE pass at
    // another rung the same day — that is the fill, and it clears nothing.)
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(queue.filter((e) => e.rung === 'interpretation').map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(queue.filter((e) => e.rung === 'repetition').map((e) => e.seq)).toEqual([6, 7]);
    // And nothing is offered twice at the same rung, credited or not.
    const pairs = full.map((e) => `${e.rung}:${e.seq}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe('sentences with no audio', () => {
  // The recovered corpus carries 818 sentences that never had their audio
  // split. Every rung's prompt plays audio, so they cannot be drilled — but
  // they were genuinely studied in 2017 and must survive as history.
  const playable = new Set([1, 2, 5, 6, 7]);

  it('never admits an unplayable sentence as new material', () => {
    const queue = credited(build({ dailyLimit: 3, playable }));
    expect(queue.map((e) => e.seq)).toEqual([1, 2, 5]);
  });

  it('never queues an unplayable sentence as a graduate', () => {
    // seq 3 was studied years ago but has no audio; promoting it would put a
    // silent, uncompletable card in front of the learner.
    const log = [ev(3, 'repetition', 1), ev(5, 'repetition', 1)];
    const queue = build({ log, day: 2, dailyLimit: 0, playable });
    expect(queue).toEqual([{ seq: 5, rung: 'dictation', done: false }]);
  });

  it('still counts unplayable history when admitting new material', () => {
    // seq 3 is studied-but-unplayable: it must not reappear as new material
    // either, even though it can never be queued.
    const log = [ev(3, 'repetition', 1)];
    const queue = build({ log, day: 2, dailyLimit: 2, playable: new Set([1, 2, 3]) });
    expect(queue.filter((e) => e.rung === 'repetition').map((e) => e.seq)).toEqual([1, 2]);
  });

  it('treats an absent playable set as "everything is playable"', () => {
    expect(credited(build({ dailyLimit: 2 })).map((e) => e.seq)).toEqual([1, 2]);
  });
});

describe('malformed log entries', () => {
  it('ignores events it cannot place rather than corrupting the queue', () => {
    const log = [null, {}, { seq: 'x', rung: 'repetition', day: 1 }, ev(1, 'repetition', 1)];
    const queue = build({ log, day: 2, dailyLimit: 0 });
    expect(queue).toEqual([{ seq: 1, rung: 'dictation', done: false }]);
  });
});

describe('summarizeQueue', () => {
  it('folds totals overall and per rung', () => {
    const queue = [
      { seq: 1, rung: 'repetition', done: true },
      { seq: 2, rung: 'repetition', done: false },
      { seq: 3, rung: 'dictation', done: true },
    ];
    expect(summarizeQueue(queue)).toEqual({
      total: 3,
      done: 2,
      byRung: {
        repetition: { total: 2, done: 1 },
        dictation: { total: 1, done: 1 },
      },
    });
  });

  it('handles an empty queue', () => {
    expect(summarizeQueue([])).toEqual({ total: 0, done: 0, byRung: {} });
  });
});

// ---------------------------------------------------------------------------
// The cold start
// ---------------------------------------------------------------------------

describe('warm-up fill', () => {
  const languages = { source: 'EN', target: 'KR' };
  const capabilities = { microphone: true, textInput: ['EN', 'KR'] };
  const LIMIT = 3;
  const CHAIN = ['repetition', 'dictation', 'recording', 'interpretation'];
  const FULL_DAY = LIMIT * CHAIN.length;

  const build = (log, day) => buildDayQueue({
    log, day, dailyLimit: LIMIT, corpusSize: 100, capabilities, languages,
  });

  /** Complete every entry a day offered, the way a finished sitting would. */
  const completeAll = (log, day, queue) => {
    for (const entry of queue) {
      log.push({
        day, seq: entry.seq, rung: entry.rung,
        ...(entry.practice ? { practice: true } : {}),
      });
    }
    return log;
  };

  const shape = (queue) => {
    const of = (practice) => queue
      .filter((e) => Boolean(e.practice) === practice)
      .map((e) => `${e.rung}:${e.seq}`);
    return { credited: of(false), practice: of(true) };
  };

  it('gives day one a full sitting instead of a quarter of one', () => {
    const queue = build([], 1);
    expect(queue).toHaveLength(FULL_DAY);
    const { credited, practice } = shape(queue);
    // Only the entry rung is credited on day one — nothing has cleared anything.
    expect(credited).toEqual(['repetition:1', 'repetition:2', 'repetition:3']);
    // The same three sentences walk the rest of the ladder as practice.
    expect(practice).toEqual([
      'dictation:1', 'dictation:2', 'dictation:3',
      'recording:1', 'recording:2', 'recording:3',
      'interpretation:1', 'interpretation:2', 'interpretation:3',
    ]);
  });

  it('holds a full sitting every day and reaches steady state on day four', () => {
    const log = [];
    const counts = [];
    for (let day = 1; day <= 6; day += 1) {
      const queue = build(log, day);
      counts.push({ day, total: queue.length, practice: queue.filter((e) => e.practice).length });
      completeAll(log, day, queue);
    }
    expect(counts.map((c) => c.total)).toEqual([12, 12, 12, 12, 12, 12]);
    // The fill shrinks as graduates arrive and is gone once they fill the day.
    expect(counts.map((c) => c.practice)).toEqual([9, 6, 3, 0, 0, 0]);
  });

  it('never advances a sentence on a practice pass', () => {
    const log = [];
    const dayOne = build(log, 1);
    completeAll(log, 1, dayOne);

    // Sentence 1 was practised at dictation, recording AND interpretation on
    // day one. If practice counted, it would have graduated off the ladder.
    const dayTwo = build(log, 2);
    const credited = dayTwo.filter((e) => !e.practice).map((e) => `${e.rung}:${e.seq}`);
    expect(credited).toContain('dictation:1');
    expect(credited).not.toContain('recording:1');
    expect(credited).not.toContain('interpretation:1');
  });

  it('does not re-admit a practised sentence as new material', () => {
    const log = [];
    completeAll(log, 1, build(log, 1));
    const dayTwo = build(log, 2);
    const newlyAdmitted = dayTwo
      .filter((e) => !e.practice && e.rung === 'repetition')
      .map((e) => e.seq);
    expect(newlyAdmitted).toEqual([4, 5, 6]);
  });

  it('marks a practice entry done once its own pass is logged', () => {
    const log = [];
    const queue = build(log, 1);
    // Work the day in order: the credited entry-rung passes come first, then
    // the practice passes behind them.
    for (const entry of queue.filter((e) => !e.practice)) {
      log.push({ day: 1, seq: entry.seq, rung: entry.rung });
    }
    const target = build(log, 1).find((e) => e.practice);
    expect(target.done).toBe(false);

    log.push({ day: 1, seq: target.seq, rung: target.rung, practice: true });
    const again = build(log, 1)
      .find((e) => e.practice && e.seq === target.seq && e.rung === target.rung);
    expect(again.done).toBe(true);
  });

  it('a time gap alone does not bring the fill back', () => {
    const log = [];
    for (let day = 1; day <= 5; day += 1) completeAll(log, day, build(log, day));
    // Due graduates do not expire: a sentence that cleared a rung is still
    // owed the next one however long the learner was away. So a gap leaves the
    // day full, and the fill has nothing to add.
    const later = build(log, 40);
    expect(later).toHaveLength(FULL_DAY);
    expect(later.filter((e) => e.practice)).toEqual([]);
  });

  it('comes back when the day gets longer than the pipeline feeding it', () => {
    const log = [];
    for (let day = 1; day <= 5; day += 1) completeAll(log, day, build(log, day));
    // Raising lessonSize — a real thing to do once a learner settles in —
    // makes the day bigger than the graduates arriving to fill it, so the
    // warm-up behaviour returns on its own for as long as it is needed.
    const raised = buildDayQueue({
      log, day: 6, dailyLimit: 5, corpusSize: 100, capabilities, languages,
    });
    expect(raised).toHaveLength(5 * CHAIN.length);
    expect(raised.some((e) => e.practice)).toBe(true);
  });

  it('adds nothing for an established learner whose day is already full', () => {
    const log = [];
    for (let day = 1; day <= 8; day += 1) completeAll(log, day, build(log, day));
    const queue = build(log, 9);
    expect(queue.filter((e) => e.practice)).toEqual([]);
    expect(queue).toHaveLength(FULL_DAY);
  });

  it('sizes the fill to the chain the device can actually serve', () => {
    // No microphone and no Korean keyboard: two rungs, so a full day is 2x.
    const queue = buildDayQueue({
      log: [], day: 1, dailyLimit: LIMIT, corpusSize: 100, languages,
      capabilities: { microphone: false, textInput: ['EN'] },
    });
    expect(queue).toHaveLength(LIMIT * 2);
    expect(queue.filter((e) => e.practice)).toHaveLength(LIMIT);
  });

  it('leaves credited entries in their original shape', () => {
    const credited = build([], 1).filter((e) => !e.practice);
    for (const entry of credited) expect(entry).not.toHaveProperty('practice');
  });
});
