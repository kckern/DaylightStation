import { describe, expect, it } from 'vitest';
import { normalizeUnits, unitFor, unitProgress } from './units.mjs';

// The live glossika-korean partition: three Glossika volumes of 1000, then a
// tail of 1143 sentences from another source whose provenance is not settled.
const UNITS = [
  { from: 1, label: 'Fluency 1' },
  { from: 1001, label: 'Fluency 2' },
  { from: 2001, label: 'Fluency 3' },
  { from: 3001, label: 'More practice' },
];
const CORPUS_SIZE = 4143;
const labelAt = (seq, units = UNITS) => unitFor({ units, seq })?.label ?? null;

describe('unitFor', () => {
  it.each([
    [1, 'Fluency 1'], [640, 'Fluency 1'], [1000, 'Fluency 1'],
    [1001, 'Fluency 2'], [2000, 'Fluency 2'],
    [2001, 'Fluency 3'], [3000, 'Fluency 3'],
    [3001, 'More practice'], [4143, 'More practice'],
  ])('places sentence %i in %s', (seq, label) => {
    expect(labelAt(seq)).toBe(label);
  });

  it('changes unit exactly at the declared boundary, never a sentence early or late', () => {
    expect([labelAt(1000), labelAt(1001)]).toEqual(['Fluency 1', 'Fluency 2']);
  });

  it('reads a list written out of order correctly rather than mislabelling everything after it', () => {
    const jumbled = [UNITS[2], UNITS[0], UNITS[3], UNITS[1]];
    expect(labelAt(1500, jumbled)).toBe('Fluency 2');
    expect(normalizeUnits(jumbled).map((unit) => unit.from)).toEqual([1, 1001, 2001, 3001]);
  });

  it('carries no unit past the last boundary, because the last unit runs to the end', () => {
    expect(labelAt(999_999)).toBe('More practice');
  });

  it('invents no unit for a sentence before the first declared boundary', () => {
    expect(labelAt(4, [{ from: 1001, label: 'Fluency 2' }])).toBeNull();
  });

  it.each([
    ['no units at all', undefined], ['an empty list', []], ['a non-list', 'Fluency 1'],
  ])('answers null for an unpartitioned course: %s', (_label, units) => {
    expect(unitFor({ units, seq: 640 })).toBeNull();
  });

  it.each([
    ['a missing seq', undefined], ['a zero seq', 0], ['a negative seq', -3], ['a fractional seq', 2.5],
  ])('answers null for %s rather than guessing a position', (_label, seq) => {
    expect(unitFor({ units: UNITS, seq })).toBeNull();
  });

  it.each([
    ['no label', { from: 5 }],
    ['a blank label', { from: 5, label: '   ' }],
    ['a non-integer boundary', { from: 5.5, label: 'Half' }],
    ['a boundary below one', { from: 0, label: 'Zero' }],
  ])('ignores an entry with %s instead of naming a position it cannot', (_label, bad) => {
    expect(normalizeUnits([...UNITS, bad])).toHaveLength(UNITS.length);
  });

  it('trims a hand-typed label', () => {
    expect(labelAt(1, [{ from: 1, label: '  Fluency 1  ' }])).toBe('Fluency 1');
  });
});

describe('unitProgress', () => {
  it('measures within the unit, not from the start of the corpus', () => {
    expect(unitProgress({ units: UNITS, seq: 1200, corpusSize: CORPUS_SIZE }))
      .toEqual({ label: 'Fluency 2', completed: 200, total: 1000 });
  });

  it('closes the last unit with the corpus size, which is the only thing that can', () => {
    expect(unitProgress({ units: UNITS, seq: 3001, corpusSize: CORPUS_SIZE }))
      .toEqual({ label: 'More practice', completed: 1, total: 1143 });
  });

  it('counts the first sentence of a unit as one done, not zero', () => {
    expect(unitProgress({ units: UNITS, seq: 1, corpusSize: CORPUS_SIZE }))
      .toMatchObject({ completed: 1, total: 1000 });
  });

  it('refuses a bar for the last unit when nothing says where the corpus ends', () => {
    expect(unitProgress({ units: UNITS, seq: 3500 })).toBeNull();
  });

  it('still measures an inner unit without a corpus size, since its successor closes it', () => {
    expect(unitProgress({ units: UNITS, seq: 1200 }))
      .toEqual({ label: 'Fluency 2', completed: 200, total: 1000 });
  });

  it('answers null for an unpartitioned course', () => {
    expect(unitProgress({ units: [], seq: 640, corpusSize: CORPUS_SIZE })).toBeNull();
  });
});
