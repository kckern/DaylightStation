import { describe, expect, it } from 'vitest';
import { detectEntryShift, entryShiftReason, entryShiftSentence, lateEntryWaitUntil } from './entryShift.js';

// Eight quarters at 60 bpm after a four-click lead-in: targets 4000, 5000 … 11000 ms,
// each judged ±400 ms (0.4 × the 1000 ms gap).
const PITCHES = [64, 67, 60, 62, 64, 65, 67, 69];
const attempt = (pitches = PITCHES) => ({
  startedAt: 0, leadInMs: 4000, originQuarter: 0,
  policy: { windowFraction: 0.4, windowMinMs: 80, windowMaxMs: 400 },
  expectation: {
    tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
    events: pitches.map((midi, i) => ({ id: `e${i}`, onsetQuarter: i, durationQuarters: 1, notes: [{ id: `n${i}`, midi }] })),
  },
});
const BEAT = 1000;
const target = (i) => 4000 + i * BEAT;
/** The take as played: one onset per note at its target + offset (+ jitter). */
const take = (offsetMs, { jitter = [], pitches = PITCHES, only } = {}) => pitches
  .map((midi, i) => ({ midi, t: target(i) + offsetMs + (jitter[i % jitter.length] ?? 0) }))
  .filter((onset) => !only || only(onset));

describe('detectEntryShift', () => {
  it('names a steady take one beat late (+1), with the last note in the log', () => {
    const onsets = take(BEAT + 150, { jitter: [50, -40, 20, 0] });
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: -1500, to: target(7) + BEAT + 400 }))
      .toMatchObject({ beats: 1, matched: 8, possible: 8 });
  });

  it('names a late entry when the last note fell after the take (N − |k| reachable)', () => {
    const onsets = take(BEAT + 100).slice(0, 7);
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: -1500, to: target(7) + 300 }))
      .toMatchObject({ beats: 1, matched: 7, possible: 7 });
  });

  it('names a take one beat early (−1), its first note in the count-in', () => {
    const onsets = [{ midi: 55, t: -1500 }, ...take(-BEAT - 80)];
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: -1500, to: target(7) + 500 }))
      .toMatchObject({ beats: -1, matched: 8 });
  });

  it('names two beats late', () => {
    const onsets = take(2 * BEAT + 60);
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: 0, to: target(7) + 2 * BEAT + 400 }))
      .toMatchObject({ beats: 2 });
  });

  it('names nothing for a take on the beat', () => {
    expect(detectEntryShift(attempt(), take(40), { beatMs: BEAT, from: 0, to: 12000 })).toBeNull();
  });

  it('names nothing for random wrong notes', () => {
    const onsets = [61, 70, 58, 73, 66, 59, 71, 63].map((midi, i) => ({ midi, t: target(i) + 900 }));
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: 0, to: 13000 })).toBeNull();
  });

  it('names nothing for the right notes played sloppily, half a beat either way', () => {
    const onsets = take(0, { jitter: [520, -480, 600, -550, 450, -620, 500, -500] });
    expect(detectEntryShift(attempt(), onsets, { beatMs: BEAT, from: 0, to: 13000 })).toBeNull();
  });
});

describe('lateEntryWaitUntil', () => {
  it('waits for the last note when the first two onsets sit one beat late', () => {
    const onsets = take(BEAT + 120).slice(0, 6);
    expect(lateEntryWaitUntil(attempt(), onsets, { beatMs: BEAT })).toBe(target(7) + BEAT + 400);
  });

  it('stops waiting once the shifted last note is in the log', () => {
    expect(lateEntryWaitUntil(attempt(), take(BEAT + 120), { beatMs: BEAT })).toBeNull();
  });

  it('does not wait for a take that began on the beat', () => {
    expect(lateEntryWaitUntil(attempt(), take(30).slice(0, 7), { beatMs: BEAT })).toBeNull();
  });

  it('never waits more than two beats after the last target', () => {
    const onsets = take(2 * BEAT + 50).slice(0, 5);
    expect(lateEntryWaitUntil(attempt(), onsets, { beatMs: BEAT })).toBe(target(7) + 2 * BEAT);
  });
});

describe('entryShiftSentence', () => {
  it('says which way and how far, with what to do', () => {
    expect(entryShiftSentence(1)).toBe('You started one beat late — start on the click after the count.');
    expect(entryShiftSentence(-2)).toBe('You started two beats early — wait for the click after the count.');
    expect(entryShiftSentence(0)).toBeNull();
    expect(entryShiftReason(1)).toBe('entry-late');
    expect(entryShiftReason(-1)).toBe('entry-early');
  });
});
