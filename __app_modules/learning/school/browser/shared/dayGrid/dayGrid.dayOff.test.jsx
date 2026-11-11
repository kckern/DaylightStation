import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DayGrid from "./DayGrid.jsx";
import { DAY_STATES, layoutDayGrid } from "./dayGridModel.js";

describe('the day-off square', () => {
  it('maps exempt / day_off to its own dayoff state; household_calendar stays blue exempt', () => {
    expect(DAY_STATES).toContain('dayoff');
    const grid = layoutDayGrid([
      { studyDay: '2026-11-11', state: 'exempt', reason: 'day_off', label: 'Veterans Day' },
      { studyDay: '2026-11-12', state: 'exempt', reason: 'household_calendar' },
    ]);
    const cells = grid.cells.filter(Boolean);
    expect(cells[0]).toMatchObject({ state: 'dayoff', label: 'Veterans Day' });
    expect(cells[1].state).toBe('exempt');
  });

  it('draws the dayoff state and names it', () => {
    render(<DayGrid days={[{ studyDay: '2026-11-11', state: 'exempt', reason: 'day_off' }]} studyDay="2026-11-11" />);
    const cell = screen.getByTestId('day-grid-today');
    expect(cell).toHaveAttribute('data-state', 'dayoff');
    expect(cell.getAttribute('title')).toMatch(/at home/);
  });
});
