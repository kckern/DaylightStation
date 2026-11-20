import { describe, it, expect } from 'vitest';
import {
  segmentEditorReducer as reduce,
  initSegmentEditor,
  uncoveredBars,
  errors,
  idForIndex,
  nextSegmentId,
} from './segmentEditor.js';

const deepFreeze = (o) => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

const make = (segments, measureCount = 10) => deepFreeze(initSegmentEditor({ segments, measureCount }));
const ranges = (state) => state.segments.map((s) => [s.id, s.start, s.end]);

describe('initSegmentEditor', () => {
  it('sorts by start and trims ids without mutating input', () => {
    const input = deepFreeze([{ id: ' b ', start: 5, end: 9 }, { id: 'a', start: 0, end: 4 }]);
    const s = initSegmentEditor({ segments: input, measureCount: 10 });
    expect(ranges(s)).toEqual([['a', 0, 4], ['b', 5, 9]]);
    expect(input[0].id).toBe(' b ');
  });
  it('treats missing segments as empty', () => {
    expect(initSegmentEditor({ measureCount: 4 }).segments).toEqual([]);
  });
});

describe('id generation', () => {
  it.each([[0, 'a'], [25, 'z'], [26, 'aa'], [27, 'ab'], [51, 'az'], [52, 'ba'], [701, 'zz'], [702, 'aaa']])(
    'index %i → %s', (n, id) => { expect(idForIndex(n)).toBe(id); },
  );
  it('picks the first unused id, filling gaps', () => {
    expect(nextSegmentId([{ id: 'a' }, { id: 'c' }])).toBe('b');
  });
  it('goes past z', () => {
    const all = Array.from({ length: 26 }, (_, i) => ({ id: idForIndex(i) }));
    expect(nextSegmentId(all)).toBe('aa');
    expect(nextSegmentId([...all, { id: 'aa' }])).toBe('ab');
  });
});

describe('split', () => {
  const base = make([{ id: 'a', start: 0, end: 9, name: 'Whole', parts: ['rh'] }]);
  it('splits at a barline strictly inside a segment', () => {
    const s = reduce(base, { type: 'split', atBarline: 3 });
    expect(s.segments).toEqual([
      { id: 'a', start: 0, end: 3, name: 'Whole', parts: ['rh'] },
      { id: 'b', start: 4, end: 9 },
    ]);
  });
  it('splits at the first barline (k = start)', () => {
    expect(ranges(reduce(base, { type: 'split', atBarline: 0 }))).toEqual([['a', 0, 0], ['b', 1, 9]]);
  });
  it('splits at the last inner barline (k = end - 1)', () => {
    expect(ranges(reduce(base, { type: 'split', atBarline: 8 }))).toEqual([['a', 0, 8], ['b', 9, 9]]);
  });
  it.each([[9, 'at the segment end'], [-1, 'before the piece'], [12, 'past the piece'], [1.5, 'non-integer']])(
    'no-op at %s (%s)', (k) => { expect(reduce(base, { type: 'split', atBarline: k })).toBe(base); },
  );
  it('no-op on a barline between two segments', () => {
    const st = make([{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 5, end: 9 }]);
    expect(reduce(st, { type: 'split', atBarline: 4 })).toBe(st);
  });
  it('no-op on a barline in uncovered bars', () => {
    const st = make([{ id: 'a', start: 0, end: 2 }]);
    expect(reduce(st, { type: 'split', atBarline: 5 })).toBe(st);
  });
  it('gives the right half the next unused id and keeps order', () => {
    const st = make([{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 5, end: 9 }]);
    expect(ranges(reduce(st, { type: 'split', atBarline: 1 }))).toEqual([['a', 0, 1], ['c', 2, 4], ['b', 5, 9]]);
  });
  it('generates ids past z', () => {
    const segs = Array.from({ length: 26 }, (_, i) => ({ id: idForIndex(i), start: i * 2, end: i * 2 + 1 }));
    const st = make(segs, 52);
    const s = reduce(st, { type: 'split', atBarline: 50 });
    expect(s.segments.at(-1)).toEqual({ id: 'aa', start: 51, end: 51 });
  });
});

describe('merge', () => {
  const st = make([
    { id: 'a', start: 0, end: 2, name: 'Intro', parts: ['rh'] },
    { id: 'b', start: 3, end: 5, name: 'Theme' },
    { id: 'c', start: 7, end: 9 },
  ]);
  it('merges with the adjacent following segment, keeping the left id/name', () => {
    const s = reduce(st, { type: 'merge', id: 'a' });
    expect(s.segments).toEqual([
      { id: 'a', start: 0, end: 5, name: 'Intro', parts: ['rh'] },
      { id: 'c', start: 7, end: 9 },
    ]);
  });
  it('no-op when the next segment is not adjacent', () => {
    expect(reduce(st, { type: 'merge', id: 'b' })).toBe(st);
  });
  it('no-op on the last segment', () => {
    expect(reduce(st, { type: 'merge', id: 'c' })).toBe(st);
  });
  it('no-op on an unknown id', () => {
    expect(reduce(st, { type: 'merge', id: 'zz' })).toBe(st);
  });
});

describe('moveBoundary', () => {
  const st = make([{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 5, end: 9 }]);
  it('moves the shared boundary left', () => {
    expect(ranges(reduce(st, { type: 'moveBoundary', leftId: 'a', newEnd: 2 }))).toEqual([['a', 0, 2], ['b', 3, 9]]);
  });
  it('moves the shared boundary right', () => {
    expect(ranges(reduce(st, { type: 'moveBoundary', leftId: 'a', newEnd: 7 }))).toEqual([['a', 0, 7], ['b', 8, 9]]);
  });
  it('clamps so the left keeps one bar', () => {
    expect(ranges(reduce(st, { type: 'moveBoundary', leftId: 'a', newEnd: -3 }))).toEqual([['a', 0, 0], ['b', 1, 9]]);
  });
  it('clamps so the right keeps one bar', () => {
    expect(ranges(reduce(st, { type: 'moveBoundary', leftId: 'a', newEnd: 99 }))).toEqual([['a', 0, 8], ['b', 9, 9]]);
  });
  it('no-op when unchanged', () => {
    expect(reduce(st, { type: 'moveBoundary', leftId: 'a', newEnd: 4 })).toBe(st);
  });
  it('no-op when not adjacent', () => {
    const gap = make([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 5, end: 9 }]);
    expect(reduce(gap, { type: 'moveBoundary', leftId: 'a', newEnd: 4 })).toBe(gap);
  });
  it('no-op for the last segment or unknown id', () => {
    expect(reduce(st, { type: 'moveBoundary', leftId: 'b', newEnd: 6 })).toBe(st);
    expect(reduce(st, { type: 'moveBoundary', leftId: 'x', newEnd: 6 })).toBe(st);
  });
  it('keeps other fields on both sides', () => {
    const named = make([{ id: 'a', start: 0, end: 4, name: 'A' }, { id: 'b', start: 5, end: 9, parts: ['lh'] }]);
    expect(reduce(named, { type: 'moveBoundary', leftId: 'a', newEnd: 6 }).segments).toEqual([
      { id: 'a', start: 0, end: 6, name: 'A' },
      { id: 'b', start: 7, end: 9, parts: ['lh'] },
    ]);
  });
});

describe('rename', () => {
  const st = make([{ id: 'a', start: 0, end: 9, name: 'Old' }]);
  it('trims the name', () => {
    expect(reduce(st, { type: 'rename', id: 'a', name: '  Chorus ' }).segments[0].name).toBe('Chorus');
  });
  it.each([[''], ['   '], [null]])('empty (%j) removes the name', (name) => {
    expect(reduce(st, { type: 'rename', id: 'a', name }).segments[0]).toEqual({ id: 'a', start: 0, end: 9 });
  });
  it('no-op on an unknown id', () => {
    expect(reduce(st, { type: 'rename', id: 'q', name: 'x' })).toBe(st);
  });
});

describe('replace', () => {
  it('loads a list, sorted, ids normalized, measureCount kept', () => {
    const st = make([{ id: 'a', start: 0, end: 9 }]);
    const s = reduce(st, { type: 'replace', segments: deepFreeze([
      { id: 'second', start: 5, end: 9, parts: ['lh'] },
      { id: ' first ', start: 0, end: 4, name: ' Intro ' },
    ]) });
    expect(s.measureCount).toBe(10);
    expect(s.segments).toEqual([
      { id: 'first', start: 0, end: 4, name: 'Intro' },
      { id: 'second', start: 5, end: 9, parts: ['lh'] },
    ]);
  });
  it('non-array clears', () => {
    expect(reduce(make([{ id: 'a', start: 0, end: 9 }]), { type: 'replace', segments: null }).segments).toEqual([]);
  });
});

describe('cover', () => {
  it('one segment over all bars with id a', () => {
    const st = make([{ id: 'x', start: 2, end: 3 }], 12);
    expect(reduce(st, { type: 'cover' }).segments).toEqual([{ id: 'a', start: 0, end: 11 }]);
  });
  it('no bars → no segments', () => {
    expect(reduce(make([], 0), { type: 'cover' }).segments).toEqual([]);
  });
});

describe('remove', () => {
  const st = make([{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 5, end: 9 }]);
  it('deletes the segment, leaving its bars uncovered', () => {
    const s = reduce(st, { type: 'remove', id: 'a' });
    expect(ranges(s)).toEqual([['b', 5, 9]]);
    expect(uncoveredBars(s)).toEqual([0, 1, 2, 3, 4]);
  });
  it('no-op on an unknown id', () => {
    expect(reduce(st, { type: 'remove', id: 'z' })).toBe(st);
  });
});

describe('setParts', () => {
  const st = make([{ id: 'a', start: 0, end: 9, parts: ['rh'] }]);
  it('stores trimmed string parts', () => {
    expect(reduce(st, { type: 'setParts', id: 'a', parts: [' rh ', 'lh'] }).segments[0].parts).toEqual(['rh', 'lh']);
  });
  it('drops non-strings and blanks', () => {
    expect(reduce(st, { type: 'setParts', id: 'a', parts: ['lh', '', 3, null] }).segments[0].parts).toEqual(['lh']);
  });
  it('empty removes parts', () => {
    expect(reduce(st, { type: 'setParts', id: 'a', parts: [] }).segments[0]).toEqual({ id: 'a', start: 0, end: 9 });
  });
  it('no-op on an unknown id', () => {
    expect(reduce(st, { type: 'setParts', id: 'b', parts: ['lh'] })).toBe(st);
  });
});

describe('unknown action', () => {
  it('returns the same state', () => {
    const st = make([]);
    expect(reduce(st, { type: 'nope' })).toBe(st);
    expect(reduce(st, undefined)).toBe(st);
  });
});

describe('immutability', () => {
  it('never mutates the input state across every action', () => {
    const st = make([
      { id: 'a', start: 0, end: 4, name: 'A', parts: ['rh'] },
      { id: 'b', start: 5, end: 9 },
    ]);
    const snapshot = JSON.stringify(st);
    const actions = [
      { type: 'split', atBarline: 2 },
      { type: 'merge', id: 'a' },
      { type: 'moveBoundary', leftId: 'a', newEnd: 6 },
      { type: 'rename', id: 'a', name: 'X' },
      { type: 'rename', id: 'a', name: '' },
      { type: 'replace', segments: [{ id: 'q', start: 0, end: 1 }] },
      { type: 'cover' },
      { type: 'remove', id: 'b' },
      { type: 'setParts', id: 'a', parts: ['lh'] },
      { type: 'setParts', id: 'a', parts: [] },
    ];
    for (const action of actions) {
      const next = reduce(st, action);
      expect(next).not.toBe(st);
      expect(next.segments).not.toBe(st.segments);
    }
    expect(JSON.stringify(st)).toBe(snapshot);
  });
});

describe('uncoveredBars', () => {
  it('lists bars no segment covers, sorted', () => {
    const st = make([{ id: 'b', start: 6, end: 7 }, { id: 'a', start: 1, end: 3 }], 10);
    expect(uncoveredBars(st)).toEqual([0, 4, 5, 8, 9]);
  });
  it('all bars when empty; none when covered', () => {
    expect(uncoveredBars(make([], 3))).toEqual([0, 1, 2]);
    expect(uncoveredBars(make([{ id: 'a', start: 0, end: 2 }], 3))).toEqual([]);
  });
});

describe('errors', () => {
  it('empty when valid', () => {
    expect(errors(make([{ id: 'a', start: 0, end: 9 }]))).toEqual([]);
  });
  it('adds empty when there are no segments', () => {
    expect(errors(make([]))).toEqual([{ code: 'empty', id: null, index: -1 }]);
  });
  it('passes validateSegments errors through', () => {
    const st = make([{ id: 'a', start: 0, end: 5 }, { id: 'a', start: 4, end: 12 }]);
    const codes = errors(st).map((e) => e.code).sort();
    expect(codes).toEqual(['duplicate-id', 'out-of-range', 'overlap']);
  });
  it('reports a bad measure count', () => {
    expect(errors(make([{ id: 'a', start: 0, end: 0 }], 0))).toEqual([{ code: 'bad-measure-count', id: null, index: -1 }]);
  });
});

describe('addSegment', () => {
  it('covers a gap with a new segment under the next free id', () => {
    const s = reduce(make([{ id: 'a', start: 0, end: 3 }, { id: 'c', start: 7, end: 9 }]), { type: 'addSegment', start: 4, end: 6 });
    expect(ranges(s)).toEqual([['a', 0, 3], ['b', 4, 6], ['c', 7, 9]]);
    expect(errors(s)).toEqual([]);
  });
  it('starts an empty editor', () => {
    const s = reduce(make([], 6), { type: 'addSegment', start: 0, end: 5 });
    expect(ranges(s)).toEqual([['a', 0, 5]]);
    expect(uncoveredBars(s)).toEqual([]);
  });
  it('round-trips with remove', () => {
    const start = make([{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 5, end: 9 }]);
    const removed = reduce(start, { type: 'remove', id: 'b' });
    expect(uncoveredBars(removed)).toEqual([5, 6, 7, 8, 9]);
    const added = reduce(removed, { type: 'addSegment', start: 5, end: 9 });
    expect(ranges(added)).toEqual([['a', 0, 4], ['b', 5, 9]]);
  });
  it.each([
    ['overlap', 3, 6],
    ['reversed', 6, 5],
    ['out of range', 8, 10],
    ['negative', -1, 2],
    ['not integers', 4.5, 6],
  ])('is a no-op when %s', (_label, start, end) => {
    const state = make([{ id: 'a', start: 0, end: 3 }]);
    expect(reduce(state, { type: 'addSegment', start, end })).toBe(state);
  });
});

describe('moveEdge', () => {
  const gap = () => make([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 7, end: 9 }]);
  it('extends an end into the gap, stopping at the neighbour', () => {
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'a', edge: 'end', to: 5 }))).toEqual([['a', 0, 5], ['b', 7, 9]]);
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'a', edge: 'end', to: 9 }))).toEqual([['a', 0, 6], ['b', 7, 9]]);
  });
  it('shrinks an end but keeps one bar', () => {
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'a', edge: 'end', to: -4 }))).toEqual([['a', 0, 0], ['b', 7, 9]]);
  });
  it('moves a start into the gap, stopping at the neighbour', () => {
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'b', edge: 'start', to: 5 }))).toEqual([['a', 0, 3], ['b', 5, 9]]);
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'b', edge: 'start', to: 0 }))).toEqual([['a', 0, 3], ['b', 4, 9]]);
    expect(ranges(reduce(gap(), { type: 'moveEdge', id: 'b', edge: 'start', to: 12 }))).toEqual([['a', 0, 3], ['b', 9, 9]]);
  });
  it('clamps to the score', () => {
    const s = make([{ id: 'a', start: 2, end: 5 }], 8);
    expect(ranges(reduce(s, { type: 'moveEdge', id: 'a', edge: 'end', to: 20 }))).toEqual([['a', 2, 7]]);
    expect(ranges(reduce(s, { type: 'moveEdge', id: 'a', edge: 'start', to: -3 }))).toEqual([['a', 0, 5]]);
  });
  it('is a no-op for unknown ids, bad edges and unchanged positions', () => {
    const s = gap();
    expect(reduce(s, { type: 'moveEdge', id: 'z', edge: 'end', to: 5 })).toBe(s);
    expect(reduce(s, { type: 'moveEdge', id: 'a', edge: 'middle', to: 5 })).toBe(s);
    expect(reduce(s, { type: 'moveEdge', id: 'a', edge: 'end', to: 3 })).toBe(s);
    expect(reduce(s, { type: 'moveEdge', id: 'a', edge: 'end', to: 'x' })).toBe(s);
  });
});
