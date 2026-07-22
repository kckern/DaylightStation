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

describe('new material', () => {
  it('admits exactly dailyLimit sentences on a fresh start', () => {
    const queue = build();
    expect(queue).toEqual([
      { seq: 1, rung: 'repetition', done: false },
      { seq: 2, rung: 'repetition', done: false },
      { seq: 3, rung: 'repetition', done: false },
    ]);
  });

  it('never admits past the end of the corpus', () => {
    expect(build({ corpusSize: 2 })).toHaveLength(2);
  });

  it('counts sentences started today against today\'s limit', () => {
    // Two already done today + one fresh = the limit, not limit + 2.
    const log = [ev(1, 'repetition', 5), ev(2, 'repetition', 5)];
    const queue = build({ log, day: 5 });
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
