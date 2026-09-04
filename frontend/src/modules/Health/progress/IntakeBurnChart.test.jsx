import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IntakeBurnChart } from './IntakeBurnChart.jsx';

const day = (date, food, exercise) => ({ date, budget: 2000, food, exercise, status: 'under' });
const gap = (date) => ({ date, error: 'NO_WEIGHT_DATA' });
const iso = (i) => new Date(Date.UTC(2026, 7, 6 + i)).toISOString().slice(0, 10);

describe('IntakeBurnChart', () => {
  it('sets the two halves from the data, not from a fixed 50/50 guess', () => {
    render(<IntakeBurnChart days={[day(iso(0), 2000, 500)]} />);
    expect(document.querySelector('.health-intakeburn__intake').style.height).toBe('80%');
    expect(document.querySelector('.health-intakeburn__burn').style.height).toBe('20%');
  });

  it('renders a down-bar for intake and an up-bar for burn, per day', () => {
    render(<IntakeBurnChart days={[day(iso(0), 2000, 500), day(iso(1), 1000, 250)]} />);
    expect(screen.getByTestId(`intake-${iso(0)}`).style.height).toBe('100%');
    expect(screen.getByTestId(`burn-${iso(0)}`).style.height).toBe('100%');
    expect(screen.getByTestId(`intake-${iso(1)}`).style.height).toBe('50%');
    expect(screen.getByTestId(`burn-${iso(1)}`).style.height).toBe('50%');
  });

  it('renders a hole as a hollow baseline marker, never as a pair of zero bars', () => {
    render(<IntakeBurnChart days={[day(iso(0), 2000, 500), gap(iso(1))]} />);
    expect(screen.getByTestId(`intakeburn-gap-${iso(1)}`)).toBeTruthy();
    expect(screen.queryByTestId(`intake-${iso(1)}`)).toBeNull();
    expect(screen.queryByTestId(`burn-${iso(1)}`)).toBeNull();
    // A genuine zero day, by contrast, keeps its bars.
    render(<IntakeBurnChart days={[day(iso(0), 2000, 500), day(iso(1), 0, 0)]} />);
    expect(screen.getAllByTestId(`intake-${iso(1)}`)[0].style.height).toBe('0%');
  });

  it('states the averages and the number of holes rather than implying none', () => {
    render(<IntakeBurnChart days={[day(iso(0), 2000, 400), day(iso(1), 1000, 200), gap(iso(2))]} />);
    const caption = document.querySelector('.health-intakeburn__caption').textContent;
    expect(caption).toContain('avg 1500 in · 300 out');
    expect(caption).toContain('1 without data');
    expect(document.querySelector('.health-intakeburn__plot').getAttribute('aria-label'))
      .toBe('2 days: average intake 1500 kcal, average burn 300 kcal, 1 days without data');
  });

  // A hole is not a 0 kcal day: averaging over it would quietly drag every
  // average down, and the number would look like a real (better) result.
  it('does not let holes dilute the averages', () => {
    render(<IntakeBurnChart days={[day(iso(0), 2000, 400), day(iso(1), 1000, 200), gap(iso(2)), gap(iso(3))]} />);
    const caption = document.querySelector('.health-intakeburn__caption').textContent;
    expect(caption).toContain('avg 1500 in · 300 out');  // over the 2 KNOWN days
    expect(caption).not.toContain('avg 750');            // not over all 4
    expect(document.querySelector('.health-intakeburn__plot').getAttribute('aria-label'))
      .toMatch(/^2 days: /);
  });

  it('says "no data yet" rather than an average of nothing', () => {
    render(<IntakeBurnChart days={[gap(iso(0)), gap(iso(1))]} />);
    expect(document.querySelector('.health-intakeburn__caption').textContent).toContain('No data yet');
  });

  it('renders empty and non-crashing before anything has loaded', () => {
    render(<IntakeBurnChart days={[]} loading />);
    expect(document.querySelector('.health-intakeburn').getAttribute('aria-busy')).toBe('true');
  });
});
