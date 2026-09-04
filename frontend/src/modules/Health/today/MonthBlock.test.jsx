import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MonthBlock } from './MonthBlock.jsx';

const day = (date, food, status = 'under') => ({
  date, budget: 2000, food, exercise: 0, remaining: 2000 - food, status, macros: {},
});
const gap = (date) => ({ date, error: 'NO_WEIGHT_DATA' });

const iso = (i) => new Date(Date.UTC(2026, 7, 6 + i)).toISOString().slice(0, 10);

describe('MonthBlock', () => {
  it('renders one slot per day it is given, and fetches nothing itself', () => {
    const days = Array.from({ length: 30 }, (_, i) => day(iso(i), 1000));
    render(<MonthBlock days={days} />);
    expect(document.querySelectorAll('.health-monthblock__slot').length).toBe(30);
    expect(screen.getByText('Last 30 days')).toBeTruthy();
  });

  it('uses the SAME bar arithmetic as the week strip', () => {
    render(<MonthBlock days={[day(iso(0), 1000), day(iso(1), 2000), day(iso(2), 4000, 'over')]} />);
    expect(screen.getByTestId(`monthbar-fill-${iso(0)}`).style.height).toBe('40%');  // 50% of budget
    expect(screen.getByTestId(`monthbar-fill-${iso(1)}`).style.height).toBe('80%');  // on budget
    expect(screen.getByTestId(`monthbar-fill-${iso(2)}`).style.height).toBe('100%'); // clamped
    expect(screen.getByTestId(`monthbar-fill-${iso(2)}`).className).toMatch(/fill--over/);
  });

  // The same honesty rule as the strip, at a month's zoom.
  it('renders a hole hollow and a genuine zero day as a real empty bar', () => {
    render(<MonthBlock days={[gap(iso(0)), day(iso(1), 0)]} />);
    expect(screen.getByTestId(`monthbar-gap-${iso(0)}`)).toBeTruthy();
    expect(screen.queryByTestId(`monthbar-fill-${iso(0)}`)).toBeNull();
    expect(screen.getByTestId(`monthbar-fill-${iso(1)}`).style.height).toBe('0%');
    expect(screen.queryByTestId(`monthbar-gap-${iso(1)}`)).toBeNull();
  });

  it('states the number of holes rather than letting them read as good days', () => {
    render(<MonthBlock days={[gap(iso(0)), gap(iso(1)), day(iso(2), 1000), day(iso(3), 4000, 'over')]} />);
    const caption = document.querySelector('.health-monthblock__caption').textContent;
    expect(caption).toContain('1 over budget');
    expect(caption).toContain('2 without data');
    expect(document.querySelector('.health-monthblock__bars').getAttribute('aria-label'))
      .toBe('2 days with data, 1 over budget, 2 without data');
  });

  it('says "no data yet" rather than "0 over budget" when the whole month is holes', () => {
    render(<MonthBlock days={[gap(iso(0)), gap(iso(1))]} />);
    expect(document.querySelector('.health-monthblock__caption').textContent).toContain('No data yet');
  });

  // M4, the month block's half: undated gaps must not collapse into one slot.
  it('renders one slot per entry even when gaps carry no date', () => {
    render(<MonthBlock days={[{ error: 'NO_WEIGHT_DATA' }, { error: 'NO_WEIGHT_DATA' }, day(iso(2), 1000)]} />);
    expect(document.querySelectorAll('.health-monthblock__slot').length).toBe(3);
    expect(document.querySelectorAll('.health-monthblock__bar--gap').length).toBe(2);
  });

  // PRD F7.1 at a month's zoom — structural, not a count of one class name.
  it('stacks NOTHING inside a bar — exactly one child, whatever its class', () => {
    render(<MonthBlock days={[day(iso(0), 1000), gap(iso(1)), day(iso(2), 0)]} />);
    for (const bar of document.querySelectorAll('.health-monthblock__bar')) {
      const isGap = bar.classList.contains('health-monthblock__bar--gap');
      expect(bar.children.length).toBe(isGap ? 0 : 1);
    }
  });

  it('carries the exercise-offset cue, same encoding as the week strip', () => {
    render(<MonthBlock days={[
      { date: iso(0), budget: 1791, food: 2040, exercise: 530, remaining: 281, status: 'under' },
      day(iso(1), 1000),
    ]} />);
    expect(screen.getByTestId(`monthbar-fill-${iso(0)}`).className).toMatch(/fill--offset/);
    expect(screen.getByTestId(`monthbar-fill-${iso(1)}`).className).not.toMatch(/fill--offset/);
  });

  it('renders an empty, non-crashing block before anything has loaded', () => {
    render(<MonthBlock days={[]} loading />);
    expect(document.querySelector('.health-monthblock').getAttribute('aria-busy')).toBe('true');
    expect(document.querySelectorAll('.health-monthblock__slot').length).toBe(0);
  });
});

describe('MonthBlock title', () => {
  it('names itself by default, and stays silent when a SectionCard already names it', () => {
    const { rerender } = render(<MonthBlock days={[day(iso(0), 100)]} />);
    expect(document.querySelector('.health-monthblock__title')).toBeTruthy();
    rerender(<MonthBlock days={[day(iso(0), 100)]} title={null} />);
    expect(document.querySelector('.health-monthblock__title')).toBeNull();
    rerender(<MonthBlock days={[day(iso(0), 100)]} title="Last 14 days" />);
    expect(document.querySelector('.health-monthblock__title').textContent).toBe('Last 14 days');
  });
});
