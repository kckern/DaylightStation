import { describe, it, expect } from 'vitest';
import {
  emptyFlow, pushOnsets, clearIfIdle, flowColumns, flowDurations, baselineOf, classifyIoi,
  SIMULTANEITY_MS, COLUMN_CAPACITY, IDLE_CLEAR_MS, HELD_CLEAR_MS,
  DEFAULT_BASELINE_MS, BASELINE_MIN_MS, BASELINE_MAX_MS, SLOW_RATIO,
} from './noteFlow.js';

// Helper: play a sequence of [midis, atMs] and return the resulting flow.
const run = (events, opts) =>
  events.reduce((f, [midis, at]) => pushOnsets(f, midis, at, opts), emptyFlow());
const play = (events, opts) => flowColumns(run(events, opts));
// Durations of the CLOSED columns only — the last is provisional and clock-dependent.
const closed = (flow) => flow.columns.map((c) => c.duration).slice(0, -1);

// A key-down surface that says "everything is still held" / "nothing is".
const allHeld = { has: () => true, size: 1 };
const noneHeld = { has: () => false, size: 0 };

describe('noteFlow — simultaneity grouping', () => {
  it('stacks a struck chord into ONE column (jitter inside the window)', () => {
    expect(play([[[48], 0], [[60], 12], [[64], 19], [[67], 28]])).toEqual([[48, 60, 64, 67]]);
  });

  it('stacks an ordinary two-hand chord whose hands land 80ms apart', () => {
    // The case the old 45ms window splintered: close-voiced LH triad, RH triad after.
    // Nearest notes are 5 semitones apart, so no register-based rule would have helped.
    const cols = play([[[48, 52, 55], 0], [[60, 64, 67], 80]], { held: allHeld });
    expect(cols).toEqual([[48, 52, 55, 60, 64, 67]]);
  });

  it('spreads a rolled chord across columns (each note past the window)', () => {
    expect(play([[[60], 0], [[64], 100], [[67], 200]])).toEqual([[60], [64], [67]]);
  });

  it('spreads an arpeggio in the order played, not sorted by pitch', () => {
    expect(play([[[67], 0], [[60], 100], [[64], 200]])).toEqual([[67], [60], [64]]);
  });

  it('measures the window from the column START, so a slow roll cannot daisy-chain', () => {
    // Each note is 60ms after the previous (inside the window pairwise) but the 3rd
    // is 120ms after the column opened — a roll, and it must not collapse to a block.
    expect(play([[[60], 0], [[64], 60], [[67], 120]])).toEqual([[60, 64], [67]]);
  });

  it('treats exactly SIMULTANEITY_MS as simultaneous, one ms later as a new column', () => {
    expect(play([[[60], 0], [[64], SIMULTANEITY_MS]])).toEqual([[60, 64]]);
    expect(play([[[60], 0], [[64], SIMULTANEITY_MS + 1]])).toEqual([[60], [64]]);
  });

  it('sorts within a column (low → high) so noteheads stack in pitch order', () => {
    expect(play([[[67, 60, 64], 0]])).toEqual([[60, 64, 67]]);
  });

  it('dedupes a retrigger inside the window instead of drawing it twice', () => {
    expect(play([[[60], 0], [[60], 20]])).toEqual([[60]]);
  });

  it('lets the SAME note appear again in a later column (repeated notes are real)', () => {
    expect(play([[[60], 0], [[60], 500]])).toEqual([[60], [60]]);
  });

  it('ignores empty onset batches (a release must not open a column)', () => {
    const flow = pushOnsets(emptyFlow(), [], 100);
    expect(flow.columns).toEqual([]);
    expect(pushOnsets(flow, [], 200)).toBe(flow); // same object → no re-render
  });
});

describe('noteFlow — the key-down overlap test', () => {
  it('does NOT merge inside the window when the earlier note was already released', () => {
    // A detached run at 60ms/note: fast enough to be inside the window, but each key
    // is up before the next lands. Time alone would have fused these into one chord.
    expect(play([[[60], 0], [[64], 60]], { held: noneHeld })).toEqual([[60], [64]]);
  });

  it('merges inside the window when the earlier notes are still down', () => {
    expect(play([[[60], 0], [[64], 60]], { held: allHeld })).toEqual([[60, 64]]);
  });

  it('does not collapse a wide arpeggio that crosses middle C', () => {
    // The regression the earlier register-based design introduced: C2→E3→G4→C6 at
    // 100ms/note drew as [C2], [E3+G4+C6]. It must stay four columns.
    const cols = play([[[36], 0], [[52], 100], [[67], 200], [[96], 300]], { held: allHeld });
    expect(cols).toEqual([[36], [52], [67], [96]]);
  });

  it('falls back to time alone when no key-down surface is supplied', () => {
    expect(play([[[60], 0], [[64], 60]])).toEqual([[60, 64]]);
  });

  it('requires EVERY note of the column to still be down, not just one', () => {
    const partial = { has: (n) => n === 60, size: 1 };
    expect(play([[[60], 0], [[64], 20], [[67], 60]], { held: partial }))
      .toEqual([[60, 64], [67]]);
  });
});

describe('noteFlow — capacity', () => {
  it('scrolls the oldest column off once capacity is exceeded', () => {
    const events = Array.from({ length: COLUMN_CAPACITY + 3 }, (_, i) => [[60 + i], i * 1000]);
    const cols = play(events);
    expect(cols).toHaveLength(COLUMN_CAPACITY);
    expect(cols[0]).toEqual([63]); // first three scrolled off
    expect(cols[cols.length - 1]).toEqual([60 + COLUMN_CAPACITY + 2]);
  });

  it('honours a custom capacity', () => {
    const events = Array.from({ length: 6 }, (_, i) => [[60 + i], i * 1000]);
    expect(play(events, { capacity: 3 })).toEqual([[63], [64], [65]]);
  });

  it('never exceeds capacity even when a single batch is huge', () => {
    const events = Array.from({ length: 40 }, (_, i) => [[40 + i], i * 500]);
    expect(play(events)).toHaveLength(COLUMN_CAPACITY);
  });
});

describe('noteFlow — idle reset', () => {
  it('clears once the keyboard has been quiet for IDLE_CLEAR_MS', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1000 + IDLE_CLEAR_MS).columns).toEqual([]);
  });

  it('holds the line through a shorter gap between phrases', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1000 + IDLE_CLEAR_MS - 1)).toBe(flow);
  });

  it('returns the SAME object when already empty (no idle re-render churn)', () => {
    const flow = emptyFlow();
    expect(clearIfIdle(flow, 999999)).toBe(flow);
  });

  it('a new note after a clear starts again at the left', () => {
    let flow = pushOnsets(emptyFlow(), [60], 0);
    flow = pushOnsets(flow, [64], 500);
    flow = clearIfIdle(flow, 500 + IDLE_CLEAR_MS);
    flow = pushOnsets(flow, [67], 9000);
    expect(flowColumns(flow)).toEqual([[67]]);
  });

  it('does NOT wipe a chord that is still being held down', () => {
    // Sitting on a final chord must not erase it — the half note is the whole point.
    const flow = pushOnsets(emptyFlow(), [60, 64, 67], 1000);
    expect(clearIfIdle(flow, 1000 + IDLE_CLEAR_MS, { held: allHeld })).toBe(flow);
  });

  it('clears anyway at HELD_CLEAR_MS, so a lost note-off cannot freeze the staff', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1000 + HELD_CLEAR_MS, { held: allHeld }).columns).toEqual([]);
  });

  it('still accepts a bare number as idleMs (older signature)', () => {
    const flow = pushOnsets(emptyFlow(), [60], 1000);
    expect(clearIfIdle(flow, 1500, 400).columns).toEqual([]);
    expect(clearIfIdle(flow, 1300, 400)).toBe(flow);
  });

  it('clears the baseline history along with the columns', () => {
    let flow = run([[[60], 0], [[64], 400], [[67], 800]]);
    expect(flow.recentIois.length).toBeGreaterThan(0);
    expect(clearIfIdle(flow, 800 + IDLE_CLEAR_MS).recentIois).toEqual([]);
  });
});

describe('noteFlow — baseline', () => {
  it('uses the default when nothing has been measured yet', () => {
    expect(baselineOf([])).toBe(DEFAULT_BASELINE_MS);
  });

  it('clamps a very fast passage up to the floor', () => {
    expect(baselineOf([120, 120, 120])).toBe(BASELINE_MIN_MS);
  });

  it('clamps a very slow passage down to the ceiling', () => {
    expect(baselineOf([2000, 2000, 2000])).toBe(BASELINE_MAX_MS);
  });

  it('keeps the half threshold clear of the idle wipe at every legal baseline', () => {
    // If SLOW_RATIO × baseline ever reached IDLE_CLEAR_MS, no half could draw.
    expect(SLOW_RATIO * BASELINE_MAX_MS).toBeLessThan(IDLE_CLEAR_MS);
  });

  it('takes the median, so one long pause does not drag the scale', () => {
    expect(baselineOf([400, 400, 5000, 400])).toBe(400);
  });

  it('remembers further back than the staff can show', () => {
    // Nine columns at 400ms: the first has scrolled off, its gap still counts.
    const flow = run(Array.from({ length: 9 }, (_, i) => [[60 + i], i * 400]));
    expect(flow.columns.length).toBe(COLUMN_CAPACITY);
    expect(flow.recentIois.length).toBe(8);
  });
});

describe('noteFlow — duration classification', () => {
  it('classifies against the ratios', () => {
    expect(classifyIoi(100, 500)).toBe('8');   // < 0.6 × 500
    expect(classifyIoi(500, 500)).toBe('q');
    expect(classifyIoi(800, 500)).toBe('h');   // > 1.5 × 500
  });

  it('draws a fast run from silence as eighths all the way through', () => {
    // The failure the baseline floor exists to prevent: with a purely relative
    // baseline, a uniform 120ms run normalises to itself and reads as quarters.
    const flow = run(Array.from({ length: 8 }, (_, i) => [[60 + i], i * 120]), { held: noneHeld });
    expect(closed(flow)).toEqual(['8', '8', '8', '8', '8', '8', '8']);
  });

  it('draws ordinary playing as quarters', () => {
    const flow = run(Array.from({ length: 6 }, (_, i) => [[60 + i], i * 500]));
    expect(closed(flow)).toEqual(['q', 'q', 'q', 'q', 'q']);
  });

  it('gives a long gap a half note', () => {
    const flow = run([[[60], 0], [[64], 900]]);
    expect(closed(flow)).toEqual(['h']);
  });

  it('reads a burst against its context: same notes, eighths only after slow playing', () => {
    const fast = [[[72], 2000], [[74], 2120]];
    const fromSlow = run([[[60], 0], [[62], 600], [[64], 1200], ...fast]);
    expect(closed(fromSlow).slice(-1)).toEqual(['8']);
  });

  it('does NOT rewrite the duration of a column already on the staff', () => {
    // Play steadily, then break into a run. The steady quarters must stay quarters
    // even though the run drags the baseline down underneath them.
    const steady = Array.from({ length: 4 }, (_, i) => [[60 + i], i * 400]);
    const before = closed(run(steady));
    const after = closed(run([...steady, [[72], 1520], [[74], 1640], [[76], 1760]]));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(before).toEqual(['q', 'q', 'q']);
  });
});

describe('noteFlow — the provisional newest column', () => {
  it('shows a quarter the moment it is struck', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    expect(flowDurations(flow, 0)).toEqual(['q']);
  });

  it('promotes itself to a half once held past the threshold', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    const threshold = SLOW_RATIO * DEFAULT_BASELINE_MS;
    expect(flowDurations(flow, threshold - 1)).toEqual(['q']);
    expect(flowDurations(flow, threshold + 1)).toEqual(['h']);
  });

  it('promotes before the idle wipe would take it (the half is actually visible)', () => {
    expect(SLOW_RATIO * DEFAULT_BASELINE_MS).toBeLessThan(IDLE_CLEAR_MS);
  });

  it('leaves closed columns alone while the newest one promotes', () => {
    const flow = run([[[60], 0], [[64], 500]]);
    expect(flowDurations(flow, 500)).toEqual(['q', 'q']);
    expect(flowDurations(flow, 500 + SLOW_RATIO * 500 + 1)).toEqual(['q', 'h']);
  });

  it('returns one duration per column', () => {
    const flow = run(Array.from({ length: 5 }, (_, i) => [[60 + i], i * 300]));
    expect(flowDurations(flow, 1200)).toHaveLength(flowColumns(flow).length);
  });
});

describe('noteFlow — immutability', () => {
  it('never mutates the flow it is given', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    const snapshot = JSON.stringify(flow);
    pushOnsets(flow, [64], 1000);
    pushOnsets(flow, [64], 10);
    clearIfIdle(flow, 999999);
    flowDurations(flow, 5000);
    expect(JSON.stringify(flow)).toBe(snapshot);
  });
});
