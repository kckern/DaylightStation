import { describe, expect, it } from 'vitest';
import { detectEntryShift, entryShiftReason, entryShiftSentence, lateEntryWaitUntil, missedCue, missedCueDueAt, MISSED_CUE_GRACE_MS } from './entryShift.js';

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

// Jingle Bells bars 1–2 at 56 bpm: E E E(half) | E E E(half). Every note is the
// same pitch, so a whole-beat shift lines up with a steady rush or drag of the
// same notes; only the ENTRY tells them apart (review 2026-11-20).
const JB_BEAT = 60000 / 56;
const jingle = () => ({
  startedAt: 0, leadInMs: 4 * JB_BEAT, originQuarter: 0,
  policy: { windowFraction: 0.4, windowMinMs: 80, windowMaxMs: 400 },
  expectation: {
    tempoMap: [{ onsetQuarter: 0, bpm: 56 }],
    events: [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2]].map(([onsetQuarter, durationQuarters], i) => (
      { id: `e${i}`, onsetQuarter, durationQuarters, notes: [{ id: `n${i}`, midi: 64 }] })),
  },
});
const JB_BEATS = [0, 1, 2, 4, 5, 6];
const jbAt = (beats) => beats.map((beat) => ({ midi: 64, t: 4 * JB_BEAT + beat * JB_BEAT }));
const jbSpan = { beatMs: JB_BEAT, from: 0, to: 4 * JB_BEAT + 9 * JB_BEAT };

describe('detectEntryShift names only a shift that explains the entry (repeated pitches)', () => {
  it('names nothing for an on-time start rushed ×1.25 (the first onset sits on the click)', () => {
    expect(detectEntryShift(jingle(), jbAt(JB_BEATS.map((b) => b * 0.8)), jbSpan)).toBeNull();
  });

  it('names nothing for an on-time start dragged ×0.8', () => {
    expect(detectEntryShift(jingle(), jbAt(JB_BEATS.map((b) => b * 1.25)), jbSpan)).toBeNull();
  });

  it('names a true one-beat-late entry on the same bars', () => {
    expect(detectEntryShift(jingle(), jbAt(JB_BEATS.map((b) => b + 1)), jbSpan)).toMatchObject({ beats: 1 });
  });

  it('names a true one-beat-early entry on the same bars', () => {
    expect(detectEntryShift(jingle(), jbAt(JB_BEATS.map((b) => b - 1)), jbSpan)).toMatchObject({ beats: -1 });
  });
});

describe('lateEntryWaitUntil on repeated pitches', () => {
  it('waits for the last note of a one-beat-late opening on E E E', () => {
    const lastTarget = 4 * JB_BEAT + 6 * JB_BEAT;
    expect(lateEntryWaitUntil(jingle(), jbAt([1, 2, 3, 5, 6]), { beatMs: JB_BEAT })).toBe(lastTarget + JB_BEAT + 400);
  });

  it('does not wait for an on-time opening on E E E', () => {
    expect(lateEntryWaitUntil(jingle(), jbAt([0, 1, 2, 4, 5]), { beatMs: JB_BEAT })).toBeNull();
  });
});

describe('detectEntryShift on a chord opening', () => {
  // Four two-note chords (C3+C4, D3+D4, E3+E4, F3+F4) one beat apart.
  const chords = () => ({
    ...attempt(),
    expectation: {
      tempoMap: [{ onsetQuarter: 0, bpm: 60 }],
      events: [60, 62, 64, 65].map((midi, i) => ({ id: `c${i}`, onsetQuarter: i, durationQuarters: 1,
        notes: [{ id: `l${i}`, midi: midi - 12 }, { id: `u${i}`, midi }] })),
    },
  });
  it('names a chord opening one beat late that misses its lowest note', () => {
    const onsets = [60, 62, 64, 65].flatMap((midi, i) => (i === 0 ? [midi] : [midi - 12, midi])
      .map((m) => ({ midi: m, t: target(i) + BEAT + 60 })));
    expect(detectEntryShift(chords(), onsets, { beatMs: BEAT, from: 0, to: target(3) + BEAT + 400 })).toMatchObject({ beats: 1 });
  });
});

describe('missedCue', () => {
  const due = 4000 + 400 + MISSED_CUE_GRACE_MS;
  it('is open until the first note\'s window has closed', () => {
    expect(missedCueDueAt(attempt())).toBe(due);
    expect(missedCue(attempt(), [], due - 1)).toBeNull();
  });
  it('is missed when nothing was played in the window', () => {
    expect(missedCue(attempt(), [], due)).toMatchObject({ targetMs: 4000, windowMs: 400, firstOnsetOffsetMs: null });
  });
  it('names how far off a note near the cue was', () => {
    expect(missedCue(attempt(), [{ midi: 64, t: 4000 + 520 }], due + 100)).toMatchObject({ firstOnsetOffsetMs: 520 });
  });
  it('is hit by any onset in the window, even a wrong note', () => {
    expect(missedCue(attempt(), [{ midi: 50, t: 4000 - 300 }], due + 2000)).toBeNull();
    expect(missedCue(attempt(), [{ midi: 64, t: 4000 + 390 }], due + 2000)).toBeNull();
  });
  it('treats a whole-beat-late entry as a missed cue, before it is even played', () => {
    expect(missedCue(attempt(), [], due + 10)).not.toBeNull();
  });
  it('is null for an attempt with no timed first note', () => {
    expect(missedCue({ ...attempt(), startedAt: NaN }, [], 99999)).toBeNull();
  });
});
