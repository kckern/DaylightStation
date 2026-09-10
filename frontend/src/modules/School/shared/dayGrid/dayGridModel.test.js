import { describe, it, expect } from 'vitest';
import { layoutDayGrid, weekStart, addDays, isoWeekday, parseKey } from './dayGridModel.js';

const day = (studyDay, state = 'met', count = null) => ({ studyDay, state, count });
const at = (grid, r, c) => grid.cells[r * grid.cols + c];

describe('layoutDayGrid', () => {
  // 2026-09-09 is a Wednesday; 2026-09-07 the Monday.
  it('weeks-as-rows: Monday first, leading and trailing blanks keep the rectangle', () => {
    const grid = layoutDayGrid([day('2026-09-09'), day('2026-09-10', 'partial', 1)]);
    expect(grid.rows).toBe(1);
    expect(grid.cols).toBe(7);
    expect(grid.cells.slice(0, 2)).toEqual([null, null]);
    expect(at(grid, 0, 2)).toMatchObject({ studyDay: '2026-09-09', weekday: 3, state: 'met', col: 2 });
    expect(at(grid, 0, 3)).toMatchObject({ studyDay: '2026-09-10', state: 'partial', count: 1 });
    expect(grid.cells.slice(4)).toEqual([null, null, null]);
    expect(grid.weekIds).toEqual(['2026-09-07']);
  });

  it('weeks-as-columns: the same days turn ninety degrees', () => {
    const grid = layoutDayGrid([day('2026-09-09'), day('2026-09-10', 'partial', 1)], { orientation: 'weeks-as-columns' });
    expect(grid.rows).toBe(7);
    expect(grid.cols).toBe(1);
    expect(at(grid, 2, 0)).toMatchObject({ studyDay: '2026-09-09', row: 2, col: 0 });
    expect(at(grid, 0, 0)).toBeNull();
  });

  it('a term that starts mid-week and ends mid-week spans whole weeks, with days inside the span but without a row drawn unknown', () => {
    const grid = layoutDayGrid([day('2026-09-01'), day('2026-09-09')], { orientation: 'weeks-as-columns', from: '2026-09-01', to: '2026-09-10' });
    // Sep 1 is a Tuesday: the Monday before is Aug 31, blank.
    expect(at(grid, 0, 0)).toBeNull();
    expect(at(grid, 1, 0)).toMatchObject({ studyDay: '2026-09-01', state: 'met' });
    expect(at(grid, 2, 0)).toMatchObject({ studyDay: '2026-09-02', state: 'unknown' });
    expect(grid.cols).toBe(2);
    // After `to` is blank, not unknown.
    expect(at(grid, 4, 1)).toBeNull();
    expect(at(grid, 3, 1)).toMatchObject({ studyDay: '2026-09-10', state: 'unknown' });
  });

  it('a 28-day window ending on a Wednesday is five rows in weeks-as-rows', () => {
    const days = Array.from({ length: 28 }, (_, i) => day(addDays('2026-08-13', i), 'none'));
    const grid = layoutDayGrid(days, { todayKey: '2026-09-09' });
    expect(grid.rows).toBe(5);
    expect(grid.cells.filter(Boolean)).toHaveLength(28);
    expect(grid.cells.filter((c) => c?.today).map((c) => c.studyDay)).toEqual(['2026-09-09']);
  });

  it('a known 14-day input, both orientations, snapshot', () => {
    const states = ['met', 'partial', 'none', 'exempt', 'met', 'rest', 'rest', 'met', 'met', 'unknown', 'none', 'met', 'rest', 'rest'];
    const days = states.map((state, i) => day(addDays('2026-08-31', i), state, i));
    const rows = layoutDayGrid(days).cells.map((c) => (c ? c.state[0] : '.')).join('');
    const cols = layoutDayGrid(days, { orientation: 'weeks-as-columns' }).cells.map((c) => (c ? c.state[0] : '.')).join('');
    expect(rows).toBe('mpnemrrmmunmrr');
    expect(cols).toBe('mmpmnuenmmrrrr');
  });

  it('ignores malformed rows and refuses a reversed span', () => {
    expect(layoutDayGrid([{ studyDay: 'nope' }, null, day('2026-09-09')]).cells.filter(Boolean)).toHaveLength(1);
    expect(layoutDayGrid([day('2026-09-09')], { from: '2026-09-10', to: '2026-09-09' }).cells).toEqual([]);
  });
});

describe('key arithmetic', () => {
  it('weekStart is the Monday; Sunday belongs to the week before', () => {
    expect(weekStart('2026-09-13')).toBe('2026-09-07');
    expect(weekStart('2026-09-07')).toBe('2026-09-07');
    expect(isoWeekday(parseKey('2026-09-13'))).toBe(7);
  });
});
