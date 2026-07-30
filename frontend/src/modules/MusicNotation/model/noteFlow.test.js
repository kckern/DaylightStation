import { describe, it, expect } from 'vitest';
import {
  emptyFlow, pushOnsets, clearIfIdle, flowColumns,
  SIMULTANEITY_MS, COLUMN_CAPACITY, IDLE_CLEAR_MS,
} from './noteFlow.js';

// Helper: play a sequence of [midis, atMs] and return the resulting columns.
const play = (events, capacity) =>
  flowColumns(events.reduce((f, [midis, at]) => pushOnsets(f, midis, at, capacity), emptyFlow()));

describe('noteFlow — simultaneity grouping', () => {
  it('stacks a struck chord into ONE column (jitter inside the window)', () => {
    // A two-handed strike: the notes never land on the same millisecond.
    expect(play([[[48], 0], [[60], 12], [[64], 19], [[67], 28]])).toEqual([[48, 60, 64, 67]]);
  });

  it('spreads a rolled chord across columns (each note past the window)', () => {
    expect(play([[[60], 0], [[64], 70], [[67], 140]])).toEqual([[60], [64], [67]]);
  });

  it('spreads an arpeggio in the order played, not sorted by pitch', () => {
    expect(play([[[67], 0], [[60], 90], [[64], 180]])).toEqual([[67], [60], [64]]);
  });

  it('measures the window from the column START, so a slow roll cannot daisy-chain', () => {
    // Each note is 30ms after the previous (inside the window pairwise) but the 3rd
    // is 60ms after the column opened — a roll, and it must not collapse to a block.
    const cols = play([[[60], 0], [[64], 30], [[67], 60]]);
    expect(cols).toEqual([[60, 64], [67]]);
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
    expect(play(events, 3)).toEqual([[63], [64], [65]]);
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
});

describe('noteFlow — immutability', () => {
  it('never mutates the flow it is given', () => {
    const flow = pushOnsets(emptyFlow(), [60], 0);
    const snapshot = JSON.stringify(flow);
    pushOnsets(flow, [64], 1000);
    pushOnsets(flow, [64], 10);
    clearIfIdle(flow, 999999);
    expect(JSON.stringify(flow)).toBe(snapshot);
  });
});
