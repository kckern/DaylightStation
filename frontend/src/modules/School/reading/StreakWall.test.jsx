import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StreakWall from './StreakWall.jsx';

const day = (studyDay, books, state, target = 2) => ({ studyDay, books, target, state });

describe('StreakWall', () => {
  it('draws one square per day, colour for the goal and number for the volume', () => {
    render(<StreakWall days={[day('2026-09-01', 1, 'partial'), day('2026-09-02', 3, 'met')]} />);
    const cells = screen.getByTestId('reading-streak').querySelectorAll('.reading-streak__day');
    expect(cells).toHaveLength(2);
    expect(cells[0]).toHaveAttribute('data-state', 'partial');
    expect(cells[0].textContent).toBe('1');
    expect(cells[1]).toHaveAttribute('data-state', 'met');
    expect(cells[1].textContent).toBe('3');
  });

  // The streak is the COLOUR. Three books against a two-book target is the same
  // green as two — a wall that graded volume would teach a child that meeting
  // the goal is not enough.
  it('gives an over-target day the same green as an exactly-met one', () => {
    render(<StreakWall days={[day('2026-09-01', 2, 'met'), day('2026-09-02', 5, 'met')]} />);
    const cells = screen.getByTestId('reading-streak').querySelectorAll('.reading-streak__day');
    expect(cells[0].getAttribute('data-state')).toBe(cells[1].getAttribute('data-state'));
    expect(cells[1].textContent).toBe('5');
  });

  it('draws a day nobody asked about as rest, with no number, never as a miss', () => {
    render(<StreakWall days={[day('2026-09-05', 0, 'none'), day('2026-09-06', 0, 'rest')]} />);
    const cells = screen.getByTestId('reading-streak').querySelectorAll('.reading-streak__day');
    expect(cells[0]).toHaveAttribute('data-state', 'none');
    expect(cells[1]).toHaveAttribute('data-state', 'rest');
    expect(cells[1].textContent).toBe('');
  });

  it('leaves a zero day blank rather than printing a wall of noughts', () => {
    render(<StreakWall days={[day('2026-09-01', 0, 'none')]} />);
    expect(screen.getByTestId('reading-streak').querySelector('.reading-streak__day').textContent).toBe('');
  });

  it('marks today, so the eye lands on the square they just filled', () => {
    render(<StreakWall days={[day('2026-09-01', 1, 'partial'), day('2026-09-02', 2, 'met')]} studyDay="2026-09-02" />);
    expect(screen.getByTestId('reading-streak-today').textContent).toBe('2');
  });

  it('renders nothing at all without days — an empty wall is width spent on nothing', () => {
    const { container } = render(<StreakWall days={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
