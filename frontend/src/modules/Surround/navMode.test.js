import { describe, it, expect } from 'vitest';
import { navReduce, navSeekTarget, navInitial, NAV_IDLE_MS, SURROUND_NAV_EVENT } from './navMode.js';

// Three groups: Act I (rows 0-1), Act II (row 2), Act III (rows 3-4).
const WORLD = {
  groups: [
    { index: 0, from: 0, count: 2 },
    { index: 1, from: 2, count: 1 },
    { index: 2, from: 3, count: 2 },
  ],
  soundingGroupIndex: 1,
  soundingRowIndex: 2,
};

describe('navMode reducer', () => {
  it('exports the event name and the idle grace', () => {
    expect(SURROUND_NAV_EVENT).toBe('surround-nav');
    expect(NAV_IDLE_MS).toBe(12000);
    expect(navInitial).toBeNull();
  });

  it('enters at the sounding row, not at the top', () => {
    expect(navReduce(navInitial, 'enter', WORLD)).toEqual({ groupIndex: 1, rowIndex: 2 });
  });

  it('down moves to the next row within the selected group, and stops at its end', () => {
    const s = navReduce({ groupIndex: 2, rowIndex: 3 }, 'down', WORLD);
    expect(s).toEqual({ groupIndex: 2, rowIndex: 4 });
    // Already on the last row of the group: it holds rather than leaking into the next.
    expect(navReduce(s, 'down', WORLD)).toEqual({ groupIndex: 2, rowIndex: 4 });
  });

  it('up past the first row of the group EXITS — the no-Esc escape hatch', () => {
    expect(navReduce({ groupIndex: 2, rowIndex: 4 }, 'up', WORLD)).toEqual({ groupIndex: 2, rowIndex: 3 });
    expect(navReduce({ groupIndex: 2, rowIndex: 3 }, 'up', WORLD)).toBeNull();
  });

  it('right previews the next group at its first row, and clamps at the last group', () => {
    expect(navReduce({ groupIndex: 0, rowIndex: 0 }, 'right', WORLD)).toEqual({ groupIndex: 1, rowIndex: 2 });
    expect(navReduce({ groupIndex: 2, rowIndex: 3 }, 'right', WORLD)).toEqual({ groupIndex: 2, rowIndex: 3 });
  });

  it('left previews the previous group at its first row, and clamps at the first', () => {
    expect(navReduce({ groupIndex: 1, rowIndex: 2 }, 'left', WORLD)).toEqual({ groupIndex: 0, rowIndex: 0 });
    expect(navReduce({ groupIndex: 0, rowIndex: 0 }, 'left', WORLD)).toEqual({ groupIndex: 0, rowIndex: 0 });
  });

  it('select and exit both leave nav mode', () => {
    expect(navReduce({ groupIndex: 0, rowIndex: 1 }, 'select', WORLD)).toBeNull();
    expect(navReduce({ groupIndex: 0, rowIndex: 1 }, 'exit', WORLD)).toBeNull();
  });

  it('an action while not in nav mode is inert, except enter', () => {
    expect(navReduce(null, 'down', WORLD)).toBeNull();
    expect(navReduce(null, 'left', WORLD)).toBeNull();
  });

  it('navSeekTarget names the selected row, and nothing when idle', () => {
    expect(navSeekTarget({ groupIndex: 2, rowIndex: 4 }, WORLD)).toBe(4);
    expect(navSeekTarget(null, WORLD)).toBeNull();
  });

  it('enters at row 0 when nothing is sounding', () => {
    const gap = { ...WORLD, soundingGroupIndex: null, soundingRowIndex: -1 };
    expect(navReduce(null, 'enter', gap)).toEqual({ groupIndex: 0, rowIndex: 0 });
  });
});
