import { describe, expect, it } from 'vitest';
import { addressedColumn, shuffledColumns } from './PianoConnectFour.jsx';

const notes = (...values) => new Map(values.map((note) => [note, { velocity: 100 }]));
const config = {
  input_mode: 'notes', column_notes: [60, 62, 64, 65, 67, 69, 71],
  column_chords: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
};

describe('Connect Four piano addressing', () => {
  it('maps a note to the dealt column and tolerates octave displacement', () => {
    expect(addressedColumn(notes(74), config, [6, 5, 4, 3, 2, 1, 0])).toBe(5);
  });

  it('maps a major chord in chord mode', () => {
    expect(addressedColumn(notes(55, 59, 62), { ...config, input_mode: 'chords' }, [0, 1, 2, 3, 4, 5, 6])).toBe(4);
  });

  it('deals every column exactly once and deterministically', () => {
    expect(shuffledColumns(42)).toEqual(shuffledColumns(42));
    expect([...shuffledColumns(42)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
