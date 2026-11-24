import { describe, it, expect } from 'vitest';
import { countInPlan, exerciseCountInPlan, countdownPresentation, askPulseQuarters, askPace, countInSentence, countUpPresentation, entryOffsetQuarters, alignCountIn, polishCountIn } from './countIn.js';

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
    expect(plan).toMatchObject({ clicks: 4, periodMs: 500, leadInMs: 2000, pulseBpm: 120, entry: 'downbeat' });
  });

  it('uses quarter pulses when the ask has no steady spacing', () => {
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 1, 1.5] }))
      .toMatchObject({ clicks: 4, periodMs: 1000, leadInMs: 4000, pulseBpm: 60, entry: 'downbeat' });
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
      .toMatchObject({ clicks: 3, periodMs: 1000, leadInMs: 3000, pulseBpm: 60, entry: 'aligned', readyBar: false });
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
      .toMatchObject({ clicks: 4, periodMs: 1000, leadInMs: 4000, pulseBpm: 60, entry: 'downbeat' });
  });
  it.each([undefined, [], [{ onsetQuarter: NaN, durationQuarters: 4 }]])('returns null for unusable measures %#', (measures) => {
    expect(entryOffsetQuarters({ measures, firstOnsetQuarter: 0 })).toBeNull();
  });
});

describe('a short first bar that is not a pickup', () => {
  it('counts a written 2/4 opening bar from its downbeat, not as a pickup', () => {
    const measures = [{ onsetQuarter: 0, durationQuarters: 2, implicit: false },
      { onsetQuarter: 2, durationQuarters: 4, implicit: false }, { onsetQuarter: 6, durationQuarters: 4, implicit: false }];
    expect(entryOffsetQuarters({ measures, firstOnsetQuarter: 0 })).toBe(0);
  });
  it('still reads a bar marked implicit as a pickup', () => {
    const measures = [{ onsetQuarter: 0, durationQuarters: 1, implicit: true }, { onsetQuarter: 1, durationQuarters: 4, implicit: false }];
    expect(entryOffsetQuarters({ measures, firstOnsetQuarter: 0 })).toBe(3);
  });
});

describe('the Polish count-in', () => {
  const plan = { beats: 4, periodMs: 500, totalMs: 2000, subdivision: 1 };
  const pickup = [{ onsetQuarter: 0, durationQuarters: 1 }, { onsetQuarter: 1, durationQuarters: 4 }, { onsetQuarter: 5, durationQuarters: 4 }];
  const timeSig = { beats: 4, beatType: 4 };
  it('counts the beats before a pickup from the top, keeping at least 1.5 s', () => {
    // three clicks of 500 ms is exactly 1.5 s
    expect(polishCountIn(plan, { fromTop: true, measures: pickup, firstOnsetQuarter: 0, timeSig }))
      .toEqual({ ...plan, beats: 3, totalMs: 1500, entry: 'aligned' });
    // at 400 ms a click, three is 1.2 s: a bar more
    expect(polishCountIn({ ...plan, periodMs: 400, totalMs: 1600 }, { fromTop: true, measures: pickup, firstOnsetQuarter: 0, timeSig }))
      .toMatchObject({ beats: 7, entry: 'aligned' });
  });
  it('keeps the plan for a run that does not start at the top', () => {
    expect(polishCountIn(plan, { fromTop: false, measures: pickup, firstOnsetQuarter: 0, timeSig })).toEqual({ ...plan, entry: 'downbeat' });
  });
  it.each([0, -1, NaN, Infinity])('never loops on a click period of %s', (periodMs) => {
    expect(polishCountIn({ ...plan, periodMs }, { fromTop: true, measures: pickup, firstOnsetQuarter: 0, timeSig }))
      .toEqual({ ...plan, periodMs, entry: 'unaligned' });
  });
});

/**
 * THE PICKUP COUNT, in bars (2026-11-24). "Santa Claus Is Comin' to Town": 4/4, ♩=120, a one-quarter
 * pickup ("You", RH G4 on beat 4), LH resting until bar 1. The count ends with the landing bar (the
 * bar holding the passage's first note), a ready bar before it unless the landing bar alone gives
 * 2.5 s and two clicks after the press; the count belongs to the passage, not the hand.
 */
describe('the pickup count, in bars', () => {
  const santaBars = [{ onsetQuarter: 0, durationQuarters: 1, implicit: true },
    ...Array.from({ length: 4 }, (_, i) => ({ onsetQuarter: 1 + i * 4, durationQuarters: 4 }))];
  const rh = [0, 1, 1.5, 2, 3, 4, 4.5];
  const lh = [1, 5];
  const plan = (over) => exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 120, measures: santaBars, passageFirstOnsetQuarter: 0, ...over });
  const kinds = (p) => p.slots.map((slot) => slot.kind);
  const beats = (p) => p.slots.map((slot) => slot.beat);

  it('Santa Claus RH at 120: a ready bar, then 1 2 3, and the note on 4', () => {
    const p = plan({ onsetQuarters: rh });
    expect(p).toMatchObject({ clicks: 7, periodMs: 500, leadInMs: 3500, entry: 'aligned', readyBar: true, bars: 2 });
    expect(beats(p)).toEqual([1, 2, 3, 4, 1, 2, 3, 4]);
    expect(kinds(p)).toEqual(['count', 'count', 'count', 'count', 'count', 'count', 'count', 'note']);
  });

  it('LH of the same passage counts the same bar and rests on the pickup beat', () => {
    const r = plan({ onsetQuarters: rh });
    const l = plan({ onsetQuarters: lh });
    expect(l).toMatchObject({ clicks: 8, leadInMs: 4000, readyBar: true });
    expect(l.slots[7].kind).toBe('rest');
    expect(l.slots[8]).toMatchObject({ kind: 'note', beat: 1 });
    expect(l.slots.slice(0, 7)).toEqual(r.slots.slice(0, 7));
  });

  it('at 60 bpm the landing bar alone is the count', () => {
    const p = plan({ gradedBpm: 60, onsetQuarters: rh });
    expect(p).toMatchObject({ clicks: 3, leadInMs: 3000, readyBar: false, bars: 1 });
    expect(kinds(p)).toEqual(['count', 'count', 'count', 'note']);
  });

  it('a missed-cue restart always has the ready bar', () => {
    expect(plan({ gradedBpm: 60, onsetQuarters: rh, forceReadyBar: true })).toMatchObject({ clicks: 7, leadInMs: 7000, readyBar: true });
  });

  it('a three-beat pickup always gets a ready bar', () => {
    const three = [{ onsetQuarter: 0, durationQuarters: 3, implicit: true }, { onsetQuarter: 3, durationQuarters: 4 }, { onsetQuarter: 7, durationQuarters: 4 }];
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 40, onsetQuarters: [0, 1, 2, 3], measures: three, passageFirstOnsetQuarter: 0 });
    expect(p).toMatchObject({ clicks: 5, readyBar: true });
    expect(kinds(p).at(-1)).toBe('note');
    expect(beats(p)).toEqual([1, 2, 3, 4, 1, 2]);
  });

  it('an eighth-note pickup clicks through 4 and lands on a half slot', () => {
    const eighth = [{ onsetQuarter: 0, durationQuarters: 0.5, implicit: true }, { onsetQuarter: 0.5, durationQuarters: 4 }, { onsetQuarter: 4.5, durationQuarters: 4 }];
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 0.5, 1.5], measures: eighth, passageFirstOnsetQuarter: 0 });
    expect(p).toMatchObject({ clicks: 4, leadInMs: 3500, entry: 'offbeat', readyBar: false });
    // The note comes on the "and" of 4: the four counts, then the note in the second half of beat 4.
    expect(p.slots).toEqual([1, 2, 3, 4].map((beat) => ({ bar: 1, beat, kind: 'count' })).concat({ bar: 1, beat: 4, kind: 'note', half: true }));
    // The cue comes on the last click, 4.
    const at = (ms) => countUpPresentation({ clicks: p.clicks, elapsedMs: ms, leadInMs: p.leadInMs, periodMs: p.periodMs, slots: p.slots });
    expect(at(3100)).toMatchObject({ count: 4, last: true });
    expect(at(2100)).toMatchObject({ count: 3, last: false });
  });

  it('a hand entering half a click after the passage still counts whole clicks', () => {
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0.5, 1.5], measures: [{ onsetQuarter: 0, durationQuarters: 4 }, { onsetQuarter: 4, durationQuarters: 4 }], passageFirstOnsetQuarter: 0 });
    expect(Number.isInteger(p.clicks)).toBe(true);
    expect(p).toMatchObject({ clicks: 5, leadInMs: 4500 }); // clicks on 1 2 3 4 and the next 1; the note on its "and"
  });

  it('never folds a late hand into more than two bars: it counts its own bar instead', () => {
    const bars4 = [0, 1, 2, 3].map((index) => ({ onsetQuarter: index * 4, durationQuarters: 4 }));
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [8, 9], measures: bars4, passageFirstOnsetQuarter: 0 });
    expect(p.slots.length).toBeLessThanOrEqual(9);
    expect(p).toMatchObject({ clicks: 4, leadInMs: 4000, entry: 'downbeat' });
  });

  it('says how many clicks make a bar, so the click can accent each bar\'s 1', () => {
    const santa = [{ onsetQuarter: 0, durationQuarters: 1, implicit: true }, { onsetQuarter: 1, durationQuarters: 4 }, { onsetQuarter: 5, durationQuarters: 4 }];
    expect(exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 120, onsetQuarters: [0, 1, 2], measures: santa, passageFirstOnsetQuarter: 0 }).clicksPerBar).toBe(4);
    const waltz = [{ onsetQuarter: 0, durationQuarters: 1, implicit: true }, { onsetQuarter: 1, durationQuarters: 3 }, { onsetQuarter: 4, durationQuarters: 3 }];
    expect(exerciseCountInPlan({ beatsPerMeasure: 3, gradedBpm: 60, onsetQuarters: [0, 1, 2, 3], measures: waltz, passageFirstOnsetQuarter: 0 }).clicksPerBar).toBe(3);
  });

  it('3/4 pickup: 1 2 3 | 1 2 note', () => {
    const waltz = [{ onsetQuarter: 0, durationQuarters: 1, implicit: true }, { onsetQuarter: 1, durationQuarters: 3 }, { onsetQuarter: 4, durationQuarters: 3 }];
    const p = exerciseCountInPlan({ beatsPerMeasure: 3, gradedBpm: 60, onsetQuarters: [0, 1, 2, 3], measures: waltz, passageFirstOnsetQuarter: 0 });
    expect(beats(p)).toEqual([1, 2, 3, 1, 2, 3]);
    expect(kinds(p)).toEqual(['count', 'count', 'count', 'count', 'count', 'note']);
    expect(p).toMatchObject({ clicks: 5, leadInMs: 5000 });
  });

  it('a downbeat passage keeps four clicks, and its note box follows them', () => {
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 60, onsetQuarters: [0, 1], measures: [{ onsetQuarter: 0, durationQuarters: 4 }, { onsetQuarter: 4, durationQuarters: 4 }], passageFirstOnsetQuarter: 0 });
    expect(p).toMatchObject({ clicks: 4, leadInMs: 4000, entry: 'downbeat', readyBar: false });
    expect(kinds(p)).toEqual(['count', 'count', 'count', 'count', 'note']);
  });
});

describe('countUpPresentation over slots', () => {
  it('counts the slot under the click and cues the click before the note', async () => {
    const { countUpPresentation } = await import('./countIn.js');
    const p = exerciseCountInPlan({ beatsPerMeasure: 4, gradedBpm: 120, onsetQuarters: [0, 1, 2], passageFirstOnsetQuarter: 0,
      measures: [{ onsetQuarter: 0, durationQuarters: 1, implicit: true }, { onsetQuarter: 1, durationQuarters: 4 }] });
    const at = (elapsedMs) => countUpPresentation({ clicks: p.clicks, leadInMs: p.leadInMs, periodMs: p.periodMs, slots: p.slots, elapsedMs });
    expect(at(0)).toMatchObject({ count: 1, last: false });
    expect(at(2100)).toMatchObject({ count: 5, last: false });
    expect(at(3100)).toMatchObject({ count: 7, last: true });
    expect(at(3500)).toBeNull();
  });
});
