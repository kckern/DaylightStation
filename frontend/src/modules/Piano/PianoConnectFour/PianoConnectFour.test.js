import { describe, expect, it } from 'vitest';
import {
  addressedColumn, columnAddresses, dropDurationMs, lastDrop, shuffledColumns,
} from './PianoConnectFour.jsx';

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

describe('Connect Four rail addresses', () => {
  it('returns one address per column, in column order, for the unshuffled deal', () => {
    const addresses = columnAddresses(config, [0, 1, 2, 3, 4, 5, 6]);
    expect(addresses.map((address) => address.midi)).toEqual(config.column_notes);
    expect(addresses.map((address) => address.chord)).toEqual(config.column_chords);
  });

  it('follows a shuffled deal so the card over column 0 names whatever note actually drops there', () => {
    // deal[address] = column, so address 6 (note 71/B) is dealt to column 0
    // here — the rail's first card (column order) must therefore read B, not
    // the unshuffled C, or it would be lying about what column 0 plays.
    const deal = [6, 5, 4, 3, 2, 1, 0];
    const addresses = columnAddresses(config, deal);
    expect(addresses[0].midi).toBe(71);
    expect(addresses[6].midi).toBe(60);
  });

  it('labels every address with a note name, for the "names" notation', () => {
    const addresses = columnAddresses(config, [0, 1, 2, 3, 4, 5, 6]);
    expect(addresses[0].label).toBe('C4');
  });
});

describe('Connect Four gravity', () => {
  // board[0] is the TOP row; discs stack from the floor, so the newest disc in a
  // column is the topmost occupied cell in it.
  const empty = () => Array.from({ length: 6 }, () => Array(7).fill(0));

  it('finds the disc that just landed and how far it fell', () => {
    const board = empty();
    board[5][3] = 1; // floor of column 3
    expect(lastDrop(board, [3])).toEqual({ row: 5, column: 3, rows: 6, ply: 1 });
  });

  it('shortens the fall as the column fills', () => {
    const board = empty();
    board[5][3] = 1;
    board[4][3] = 2;
    expect(lastDrop(board, [3, 3])).toMatchObject({ row: 4, rows: 5 });
  });

  it('has nothing to drop before the first move', () => {
    expect(lastDrop(empty(), [])).toBeNull();
  });

  it('gives a longer fall a longer animation', () => {
    expect(dropDurationMs(6)).toBeGreaterThan(dropDurationMs(1));
  });
});
