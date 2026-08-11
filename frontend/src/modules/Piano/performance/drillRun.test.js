import { describe, it, expect } from 'vitest';
import { createDrillRun, applyDrillPress, drillProgress, finalizeDrillRun } from './drillRun.js';

// Two Hanon-style cells of 4 (real cells are 8; 4 keeps cases readable).
const SPANS = [
  { id: 0, expectedMidi: [48, 52, 53, 55] },
  { id: 1, expectedMidi: [50, 53, 55, 57] },
];
const play = (run, notes) => notes.reduce((acc, n) => {
  const r = applyDrillPress(acc.run, n);
  return { run: r.run, events: [...acc.events, r.event] };
}, { run, events: [] });

describe('drillRun', () => {
  it('advances on the expected note and reports global progress', () => {
    const { run, events } = play(createDrillRun(SPANS), [48, 52]);
    expect(events.map((e) => e.type)).toEqual(['advance', 'advance']);
    expect(drillProgress(run)).toBe(2);
  });

  it('counts a near wrong note against the current span without advancing', () => {
    const { run, events } = play(createDrillRun(SPANS), [49]);
    expect(events[0]).toEqual({ type: 'wrong', spanIndex: 0 });
    expect(drillProgress(run)).toBe(0);
    expect(run.spans[0].wrongNotes).toBe(1);
  });

  it('ignores notes outside the plausibility window', () => {
    const { run, events } = play(createDrillRun(SPANS), [100]); // 52 semitones off
    expect(events[0].type).toBe('ignored');
    expect(run.spans[0].wrongNotes).toBe(0);
  });

  it('emits span_complete at a cell boundary and complete at the end', () => {
    const { events } = play(createDrillRun(SPANS), [48, 52, 53, 55, 50, 53, 55, 57]);
    expect(events[3].type).toBe('span_complete');
    expect(events[7].type).toBe('complete');
    expect(events[7].summary.score).toBe(100);
    expect(events[7].summary.tally).toEqual({ green: 2, yellow: 0, red: 0, overall: 'green' });
    expect(events[7].summary.worst).toBeNull();
  });

  it('grades wrongs per span and finds the worst span', () => {
    // Clean first cell; second cell with 3 wrongs → pitch 4/7, continuity 0.25 → red.
    const { events } = play(createDrillRun(SPANS), [48, 52, 53, 55, 51, 51, 51, 50, 53, 55, 57]);
    const { summary } = events.at(-1);
    expect(summary.grades[0].grade).toBe('green');
    expect(summary.grades[1].grade).toBe('red');
    expect(summary.worst).toEqual({ inMeasure: 1, outMeasure: 1 });
    expect(summary.tally.overall).toBe('green'); // tallyGrades' documented rule: greens win ties (1 green, 1 red)
  });

  it('finalize grades only completed spans; an abandoned run scores what was finished', () => {
    const { run } = play(createDrillRun(SPANS), [48, 52, 53, 55, 50]); // cell 2 in progress
    const summary = finalizeDrillRun(run);
    expect(Object.keys(summary.grades)).toEqual(['0']);
    expect(summary.score).toBe(100);
  });
});
