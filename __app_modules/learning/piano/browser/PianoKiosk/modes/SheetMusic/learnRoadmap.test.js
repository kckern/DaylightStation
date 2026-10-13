import { describe, expect, it } from 'vitest';
import { applicableLearnLadder, buildLearnPassages, projectLearnPassage } from './learnRoadmap.js';

const score = (count, empty = new Set()) => {
  const measures = Array.from({ length: count }, (_, index) => ({
    index, number: index + 1, firstStep: index, lastStep: index,
  }));
  const steps = measures.map(({ index }) => ({
    notes: empty.has(index) ? [] : [
      { midi: 60 + index, staff: 0 },
      { midi: 48 + index, staff: 1 },
    ],
  }));
  return { measures, steps };
};

describe('buildLearnPassages', () => {
  it.each([
    [1, [[0, 0]]],
    [2, [[0, 1]]],
    [5, [[0, 4]]],
    [6, [[0, 2], [3, 5]]],
    [9, [[0, 4], [5, 8]]],
  ])('balances a %i-measure region without a one-bar tail', (count, ranges) => {
    expect(buildLearnPassages(score(count)).map((p) => [p.inMeasure, p.outMeasure])).toEqual(ranges);
  });

  it('never crosses rehearsal boundaries', () => {
    const input = score(10);
    const sections = [
      { label: 'A', startMeasure: 1, endMeasure: 6 },
      { label: 'B', startMeasure: 7, endMeasure: 10 },
    ];
    expect(buildLearnPassages({ ...input, sections }).map((p) => [p.section, p.inMeasure, p.outMeasure])).toEqual([
      ['A', 0, 2], ['A', 3, 5], ['B', 6, 9],
    ]);
  });

  it('omits all-rest passages but retains empty bars inside a playable passage', () => {
    const input = score(10, new Set([0, 1, 2, 3, 4, 7]));
    expect(buildLearnPassages(input).map((p) => [p.inMeasure, p.outMeasure])).toEqual([[4, 6], [7, 9]]);
  });

  it('honors overridden target and minimum sizes when a feasible partition exists', () => {
    expect(buildLearnPassages({ ...score(10), passages: { targetMeasures: 3, minMeasures: 3, maxMeasures: 5 } })
      .map((p) => p.outMeasure - p.inMeasure + 1)).toEqual([4, 3, 3]);
    expect(buildLearnPassages({ ...score(8), passages: { targetMeasures: 4, minMeasures: 4, maxMeasures: 5 } })
      .map((p) => p.outMeasure - p.inMeasure + 1)).toEqual([4, 4]);
  });

  it('uses canonical part ids for additional staves', () => {
    const input = score(3);
    input.steps[0].notes.push({ midi: 36, staff: 2 });
    expect(buildLearnPassages(input)[0].playableParts).toContain('p3');
  });
});

describe('roadmap ladder projection', () => {
  const ladder = [
    { id: 'right', parts: ['rh'], availability: 'sequential', sets: 2, reps: 3 },
    { id: 'left', parts: ['lh'], availability: 'sequential', sets: 2, reps: 3 },
    { id: 'together', parts: ['rh', 'lh'], availability: 'sequential', sets: 2, reps: 3 },
    { id: 'test-out', parts: ['rh', 'lh'], availability: 'always', sets: 1, reps: 3, completes: 'passage' },
  ];

  it('skips false hand-specific work on a single-part passage and keeps together work', () => {
    expect(applicableLearnLadder(ladder, ['rh']).map((rung) => [rung.id, rung.effectiveParts])).toEqual([
      ['together', ['rh']], ['test-out', ['rh']],
    ]);
  });

  it('expands an all-parts rung to every staff on a non-grand score', () => {
    const projected = applicableLearnLadder([
      { id: 'all', parts: ['rh', 'lh'], scope: 'all-parts' },
    ], ['rh', 'lh', 'p3']);
    expect(projected[0].effectiveParts).toEqual(['rh', 'lh', 'p3']);
  });

  it('unlocks only the first sequential rung plus always-available Test Out', () => {
    const passage = { id: 'm0-3', playableParts: ['rh', 'lh'] };
    const projected = projectLearnPassage({ passage, ladder, progress: { rungs: { right: { passCount: 6 } } } });
    expect(projected.rungs.map(({ id, state }) => [id, state])).toEqual([
      ['right', 'complete'], ['left', 'current'], ['together', 'locked'], ['test-out', 'available'],
    ]);
  });
});
