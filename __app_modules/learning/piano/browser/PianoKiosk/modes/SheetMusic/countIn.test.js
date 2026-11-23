import { describe, it, expect } from 'vitest';
import { countInPlan, exerciseCountInPlan, countdownPresentation, askPulseQuarters, askPace, countInSentence, entryOffsetQuarters, alignCountIn } from './countIn.js';

describe('exercise count-in projection', () => {
  it.each([
    { step: 1 / 3, periodMs: 4000 / 3, leadInMs: 16000 / 3, pulseBpm: 45 },
    { step: 0.5, periodMs: 2000, leadInMs: 8000, pulseBpm: 30 },
  ])('limits a slow passage with onset spacing $step to four audible pulses', ({ step, periodMs, leadInMs, pulseBpm }) => {
    // A full 4/4 bar at 15 quarter BPM would take sixteen seconds.
    const plan = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 15, onsetQuarters: [0, step, 2 * step, 3 * step] });
    expect(plan.clicks).toBe(4);
    expect(plan.periodMs).toBeCloseTo(periodMs);
    expect(plan.leadInMs).toBeCloseTo(leadInMs);
    expect(plan.leadInMs).toBe(plan.clicks * plan.periodMs);
    expect(plan.pulseBpm).toBeCloseTo(pulseBpm);
  });

  it('keeps the selected countable pulse for fast music', () => {
    const plan = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 120, onsetQuarters: [0, 0.5, 1, 1.5] });
    expect(plan).toEqual({ clicks: 4, periodMs: 500, leadInMs: 2000, pulseBpm: 120, entry: 'downbeat' });
  });

  it('uses quarter pulses when the ask has no steady spacing', () => {
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 1, 1.5] }))
      .toEqual({ clicks: 4, periodMs: 1000, leadInMs: 4000, pulseBpm: 60, entry: 'downbeat' });
  });

  it.each([0, -10, NaN, Infinity, undefined])('does not invent a pulse for unusable graded tempo %s', (gradedBpm) => {
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm, onsetQuarters: [0, 1] })).toBeNull();
  });
});

describe('countdown presentation', () => {
  it.each([
    { elapsedMs: -150, remaining: 4, progress: 1, play: false },
    { elapsedMs: 0, remaining: 4, progress: 1, play: false },
    { elapsedMs: 999, remaining: 4, progress: 0.75025, play: false },
    { elapsedMs: 1000, remaining: 3, progress: 0.75, play: false },
    { elapsedMs: 2000, remaining: 2, progress: 0.5, play: false },
    { elapsedMs: 3000, remaining: 1, progress: 0.25, play: false },
    { elapsedMs: 3999, remaining: 1, progress: 0.00025, play: false },
    { elapsedMs: 4000, remaining: 0, progress: 0, play: true },
    { elapsedMs: 18000, remaining: 0, progress: 0, play: true },
  ])('projects elapsed $elapsedMs without an independent clock', ({ elapsedMs, remaining, progress, play }) => {
    const result = countdownPresentation({ clicks: 4, elapsedMs, leadInMs: 4000 });
    expect(result.remaining).toBe(remaining);
    expect(result.progress).toBeCloseTo(progress);
    expect(result.play).toBe(play);
  });

  it('has one terminal PLAY state even when renders arrive late', () => {
    expect(countdownPresentation({ clicks: 4, elapsedMs: 4000, leadInMs: 4000 }))
      .toEqual(countdownPresentation({ clicks: 4, elapsedMs: 100000, leadInMs: 4000 }));
    expect(countdownPresentation({ clicks: 0, elapsedMs: 0, leadInMs: 0 }))
      .toEqual({ remaining: 0, progress: 0, play: true });
  });
});

describe('countInPlan', () => {
  it('one measure of beats at the scaled tempo', () => {
    expect(countInPlan({ beats: 4, bpm: 120, tempoMult: 1 })).toEqual({ beats: 4, periodMs: 500, totalMs: 2000, subdivision: 1 });
    const p = countInPlan({ beats: 3, bpm: 90, tempoMult: 0.5 });
    expect(p.beats).toBe(3);
    expect(p.periodMs).toBeCloseTo(60000 / 45, 6); // 90 * 0.5 = 45 bpm
    expect(p.totalMs).toBeCloseTo(3 * (60000 / 45), 6);
  });

  it('degenerate meter falls back to 4 beats', () => {
    expect(countInPlan({ beats: 0, bpm: 120, tempoMult: 1 }).beats).toBe(4);
    expect(countInPlan({ beats: undefined, bpm: 120, tempoMult: 1 }).beats).toBe(4);
    expect(countInPlan({ beats: 99, bpm: 120, tempoMult: 1 }).beats).toBe(4); // out of range
  });

  it('degenerate tempo falls back to 90 bpm and mult 1', () => {
    expect(countInPlan({ beats: 4, bpm: 0, tempoMult: 0 })).toEqual({ beats: 4, periodMs: 60000 / 90, totalMs: 4 * (60000 / 90), subdivision: 1 });
  });

  it('counts in half-notes above the countable rate', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.25 }); // 270 effective bpm
    expect(p.subdivision).toBe(2);
    expect(p.periodMs).toBeCloseTo(444.4, 1); // 135 clicks/min — countable
    expect(p.beats).toBe(4); // two bars' worth: one bar is only 889ms (see lead-in test)
  });

  it('leaves a normal tempo on the quarter-note pulse', () => {
    const p = countInPlan({ beats: 4, bpm: 90, tempoMult: 1 });
    expect(p.subdivision).toBe(1);
    expect(p.beats).toBe(4);
    expect(p.periodMs).toBeCloseTo(666.7, 1);
  });

  // A pulse that doesn't divide the meter teaches the wrong downbeat: two clicks a
  // half-note apart in 3/4 puts click 2 on beat 3, so the player feels a duple bar
  // right up to their entry. Worse than buzzing.
  it('never gives a triple meter a duple pulse', () => {
    const p = countInPlan({ beats: 3, bpm: 216, tempoMult: 1.25 }); // 270 effective bpm
    expect(p.subdivision).toBe(3); // one click per bar — how a teacher counts in fast 3
    expect(p.subdivision % 2).not.toBe(0);
    expect(p.periodMs).toBeCloseTo(666.7, 1); // 3 quarters at 270bpm
    expect(3 % p.subdivision).toBe(0); // the pulse divides the bar
  });

  it('counts a fast 9/8 in dotted-quarters, not half-notes', () => {
    const p = countInPlan({ beats: 9, bpm: 200, tempoMult: 1 });
    expect(p.subdivision).toBe(3);
    expect(9 % p.subdivision).toBe(0);
  });

  it('leaves an irregular meter on the quarter pulse rather than pick a wrong one', () => {
    const p = countInPlan({ beats: 5, bpm: 216, tempoMult: 1.25 });
    expect(p.subdivision).toBe(1); // 5 has no 2-or-3-based divisor to escalate to
  });

  // TEMPO_STEPS reaches 1.75x, so one halving is not enough to cover the whole
  // range. This test runs at 1.5x: 216 x 1.5 = 324 effective bpm, and a
  // half-note pulse there is still 162 clicks/min.
  it('escalates the pulse until the click rate is countable at the top of the tempo range', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.5 }); // 324 effective bpm
    expect(p.subdivision).toBe(4); // one click per bar
    expect(60000 / p.periodMs).toBeLessThanOrEqual(140);
    expect(4 % p.subdivision).toBe(0);
  });

  // The audit's grievance was "four beats in 0.89 seconds". Halving the pulse alone
  // leaves the count-in 0.89s long — countable, but no time to get hands to the keys.
  it('extends to more bars when one bar is too short to prepare in', () => {
    const p = countInPlan({ beats: 4, bpm: 216, tempoMult: 1.25 }); // one bar = 889ms
    expect(p.totalMs).toBeGreaterThanOrEqual(1500);
    expect(p.beats).toBe(4); // two bars of half-note clicks
    expect(p.totalMs).toBeCloseTo(1777.8, 1);
  });

  it('does not pad a count-in that is already long enough', () => {
    const p = countInPlan({ beats: 4, bpm: 120, tempoMult: 1 }); // one bar = 2000ms
    expect(p.beats).toBe(4);
    expect(p.totalMs).toBe(2000);
  });
});

/**
 * "PLAY AT THAT SPEED" WAS NOT TRUE, AND IT WAS THE ONLY INSTRUCTION GIVEN.
 *
 * The count-in pulse is the quarter note; the exercise bank writes its scales
 * in eighths. The gate's cued scale rung therefore clicked four times at 60bpm,
 * promised "that speed", and graded eight notes 500ms apart. Every note of a
 * correct, evenly played C major scale came back `wrong` — three attempts
 * running, 2026-09-13 — and nothing on the screen could have told the child
 * why. These pin the sentence to the grid the engine actually grades on.
 */
describe('what the clicks mean for the ask', () => {
  const onsets = (step, count) => Array.from({ length: count }, (_, i) => i * step);

  it('reads a scale written in eighths against a quarter-note click as two per click', () => {
    expect(askPace(onsets(0.5, 8), 1)).toEqual({ notesPerClick: 2, even: true });
  });

  it('reads quarter notes against the same click as one per click', () => {
    expect(askPace(onsets(1, 4), 1)).toEqual({ notesPerClick: 1, even: true });
  });

  it('reads half notes as one note every two clicks', () => {
    expect(askPace(onsets(2, 4), 1)).toEqual({ notesPerClick: 0.5, even: true });
  });

  it('follows a COARSENED click rather than assuming the quarter', () => {
    // Above ~140bpm the plan clicks half notes. Eighths against a half-note
    // click is four notes per click, and saying "two" there would be the same
    // failure in a new place.
    expect(askPace(onsets(0.5, 8), 2)).toEqual({ notesPerClick: 4, even: true });
  });

  it('declines an ask with no steady pulse, and one with no interval at all', () => {
    expect(askPace([0, 1, 1.5, 3], 1).even).toBe(false);
    expect(askPace([0], 1)).toBeNull();
    expect(askPace([], 1)).toBeNull();
    expect(askPace(onsets(0.5, 4), 0)).toBeNull();
  });

  it('refuses events that go backwards or sit on top of each other', () => {
    expect(askPace([0, 0, 1], 1)).toBeNull();
    expect(askPace([0, 2, 1], 1)).toBeNull();
  });
});

describe("the ask's own pulse", () => {
  const onsets = (step, count) => Array.from({ length: count }, (_, i) => i * step);

  it('reads a scale written in eighths as an eighth-note pulse', () => {
    expect(askPulseQuarters(onsets(0.5, 8))).toBe(0.5);
  });

  it('reads quarters as a quarter pulse, and half notes as a half', () => {
    expect(askPulseQuarters(onsets(1, 4))).toBe(1);
    expect(askPulseQuarters(onsets(2, 4))).toBe(2);
  });

  it('has no pulse to offer for an uneven ask, or one with no interval at all', () => {
    expect(askPulseQuarters([0, 1, 1.5, 3])).toBeNull();
    expect(askPulseQuarters([0])).toBeNull();
    expect(askPulseQuarters([])).toBeNull();
  });

  it('refuses events that go backwards or sit on top of each other', () => {
    expect(askPulseQuarters([0, 0, 1])).toBeNull();
    expect(askPulseQuarters([0, 2, 1])).toBeNull();
  });

  /**
   * THE WHOLE POINT, in one line: count at the ask's own pulse and the child is
   * asked for exactly one note per click. Clicking quarters at this same ask is
   * what `askPace` reports as "two per click" above — the grid that cost two
   * real runs, on 2026-09-13 and again on 2026-09-18.
   */
  it('makes one click mean one note, which counting in quarters did not', () => {
    const ask = onsets(0.5, 8);
    expect(askPace(ask, askPulseQuarters(ask))).toEqual({ notesPerClick: 1, even: true });
    expect(askPace(ask, 1)).toEqual({ notesPerClick: 2, even: true });
  });
});

describe('the sentence a child is given', () => {
  it('says two notes per click for the rung that failed', () => {
    expect(countInSentence(4, askPace(Array.from({ length: 8 }, (_, i) => i * 0.5), 1)))
      .toBe("Press any key to start. You'll hear 4 clicks, then play two notes on every click.");
  });

  it('keeps the generic promise when there is no single speed to name', () => {
    expect(countInSentence(4, null)).toBe("Press any key to start. You'll hear 4 clicks, then play at that speed.");
    expect(countInSentence(4, { notesPerClick: 1.5, even: false }))
      .toBe("Press any key to start. You'll hear 4 clicks, then play at that speed.");
    // An even but unspeakable ratio is still generic — better a vague truth
    // than a precise sentence nobody can act on.
    expect(countInSentence(4, { notesPerClick: 6, even: true }))
      .toBe("Press any key to start. You'll hear 4 clicks, then play at that speed.");
  });

  it('counts its own clicks correctly in the singular', () => {
    expect(countInSentence(1, null)).toContain('1 click,');
  });
});

describe('countUpPresentation (Learn passages)', () => {
  it('counts up one numeral per click and cues the last click, never the beat', async () => {
    const { countUpPresentation } = await import('./countIn.js');
    const plan = { clicks: 4, leadInMs: 4000 };
    // Armed, or the pre-roll before the first click: no numeral yet.
    expect(countUpPresentation({ ...plan, elapsedMs: -300 })).toEqual({ count: 0, clicks: 4, last: false });
    expect(countUpPresentation({ ...plan, elapsedMs: null })).toEqual({ count: 0, clicks: 4, last: false });
    expect([0, 999, 1000, 2500, 3000, 3999].map((elapsedMs) => countUpPresentation({ ...plan, elapsedMs })))
      .toEqual([
        { count: 1, clicks: 4, last: false }, { count: 1, clicks: 4, last: false },
        { count: 2, clicks: 4, last: false }, { count: 3, clicks: 4, last: false },
        { count: 4, clicks: 4, last: true }, { count: 4, clicks: 4, last: true },
      ]);
    // The first beat: the count is over, and there is no PLAY.
    expect(countUpPresentation({ ...plan, elapsedMs: 4000 })).toBeNull();
    expect(countUpPresentation({ clicks: 0, leadInMs: 0, elapsedMs: 0 })).toBeNull();
  });

  it('follows the plan\'s clicks whatever the meter (three clicks in 3/4)', async () => {
    const { countUpPresentation } = await import('./countIn.js');
    expect(countUpPresentation({ clicks: 3, leadInMs: 1800, elapsedMs: 1300 })).toEqual({ count: 3, clicks: 3, last: true });
  });
});

describe('pickup-aware count-in', () => {
  const bars = (first, n = 4, bar = 4) => [{ onsetQuarter: 0, durationQuarters: first },
    ...Array.from({ length: n }, (_, i) => ({ onsetQuarter: first + i * bar, durationQuarters: bar }))];

  it('puts a one-beat pickup on beat 4 of a three-click count', () => {
    expect(entryOffsetQuarters({ measures: bars(1), firstOnsetQuarter: 0 })).toBe(3);
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 1, 2, 3], measures: bars(1) }))
      .toEqual({ clicks: 3, periodMs: 1000, leadInMs: 3000, pulseBpm: 60, entry: 'aligned' });
  });
  it('counts a full bar first when only one click would come before the pickup', () => {
    expect(alignCountIn({ clicks: 3, pulseQuarters: 1, barQuarters: 3, entryQuarters: 1 })).toEqual({ clicks: 4, entry: 'aligned' });
  });
  it('counts the beats before a first note that follows a rest', () => {
    expect(entryOffsetQuarters({ measures: bars(4), firstOnsetQuarter: 2 })).toBe(2);
    expect(alignCountIn({ clicks: 4, pulseQuarters: 1, barQuarters: 4, entryQuarters: 2 })).toEqual({ clicks: 2, entry: 'aligned' });
  });
  it("leaves an eighth-note pickup on today's count-in and says so", () => {
    expect(alignCountIn({ clicks: 4, pulseQuarters: 1, barQuarters: 4, entryQuarters: 3.5 })).toEqual({ clicks: 4, entry: 'unaligned' });
  });
  it('never clicks off the beat when the pulse is coarser than the pickup', () => {
    expect(alignCountIn({ clicks: 2, pulseQuarters: 2, barQuarters: 4, entryQuarters: 3 })).toEqual({ clicks: 2, entry: 'unaligned' });
  });
  it('keeps a downbeat start exactly as today', () => {
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 1], measures: bars(4) }))
      .toEqual({ clicks: 4, periodMs: 1000, leadInMs: 4000, pulseBpm: 60, entry: 'downbeat' });
  });
  it.each([undefined, [], [{ onsetQuarter: NaN, durationQuarters: 4 }]])('returns null for unusable measures %#', (measures) => {
    expect(entryOffsetQuarters({ measures, firstOnsetQuarter: 0 })).toBeNull();
  });
});
