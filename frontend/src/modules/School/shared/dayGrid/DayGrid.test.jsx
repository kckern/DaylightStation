import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import DayGrid from './DayGrid.jsx';

const day = (studyDay, state, count = null) => ({ studyDay, state, count });

describe('DayGrid', () => {
  it('draws one cell per day given, blanks for the rest of the week, and the count only when asked', () => {
    const { rerender } = render(<DayGrid days={[day('2026-09-09', 'met', 3)]} />);
    const grid = screen.getByTestId('day-grid');
    expect(grid.querySelectorAll('.school-daygrid__cell')).toHaveLength(1);
    expect(grid.querySelectorAll('.school-daygrid__blank')).toHaveLength(6);
    expect(grid.querySelector('.school-daygrid__cell').textContent).toBe('');
    rerender(<DayGrid days={[day('2026-09-09', 'met', 3)]} showCount />);
    expect(grid.querySelector('.school-daygrid__cell').textContent).toBe('3');
  });

  it('marks today and exposes the state as data', () => {
    render(<DayGrid days={[day('2026-09-08', 'none'), day('2026-09-09', 'exempt')]} studyDay="2026-09-09" />);
    const today = screen.getByTestId('day-grid-today');
    expect(today).toHaveAttribute('data-state', 'exempt');
    expect(today).toHaveAttribute('data-day', '2026-09-09');
  });

  it('weeks-as-columns with an extra row draws one week cell per column', () => {
    render(<DayGrid
      days={[day('2026-09-01', 'met'), day('2026-09-09', 'none')]}
      orientation="weeks-as-columns" from="2026-09-01" to="2026-09-09"
      extraRow={[{ weekId: '2026-08-31', state: 'met' }, { weekId: '2026-09-07', state: 'unknown' }]}
    />);
    const grid = screen.getByTestId('day-grid');
    const weeks = grid.querySelectorAll('.school-daygrid__cell--week');
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toHaveAttribute('data-state', 'met');
    expect(grid.style.getPropertyValue('--grid-rows')).toBe('8');
    expect(grid.style.getPropertyValue('--grid-cols')).toBe('2');
  });

  it('renders nothing without days', () => {
    const { container } = render(<DayGrid days={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
