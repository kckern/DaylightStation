import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { WeekStrip } from './WeekStrip.jsx';
import { resetApiResourceCache } from '../../../lib/hooks/useApiResource.js';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

// Viewed date is "today" (2026-09-02) — the strip spans 2026-08-27..2026-09-02.
//   08-29  a real server GAP (BudgetService's NO_WEIGHT_DATA)
//   08-30  a genuine ZERO day: the equation computed fine, nothing was logged
//   09-01  over budget, past the 1.25 overshoot cap (2800 / 2000 = 140%)
//   rest   half budget
const GAP_DATE = '2026-08-29';
const ZERO_DATE = '2026-08-30';
const OVER_DATE = '2026-09-01';
// A day that ate PAST budget (2040 / 1791 = 114%) and still finished UNDER,
// because 530 kcal of exercise covered it. Taken from live data (Jul 25).
const OFFSET_DATE = '2026-07-25';
const OFFSET_TODAY = '2026-07-25';

const dayFor = (date) => {
  if (date === GAP_DATE) return { date, error: 'NO_WEIGHT_DATA' };
  if (date === OFFSET_DATE) {
    return {
      date, budget: 1791, food: 2040, exercise: 530, net: 1510,
      remaining: 281, status: 'under', stale: false, macros: {},
    };
  }
  const food = date === ZERO_DATE ? 0 : (date === OVER_DATE ? 2800 : 1000);
  return {
    date, budget: 2000, food, exercise: 0, net: food,
    remaining: 2000 - food, status: food > 2000 ? 'over' : 'under',
    stale: false, macros: { protein: 10, carbs: 20, fat: 5 },
  };
};

const RANGE_PATH = 'api/v1/health/budget/range?from=2026-08-27&to=2026-09-02';

beforeEach(() => {
  resetApiResourceCache();
  apiMock.mockReset();
  apiMock.mockImplementation(async (path) => {
    const [, qs] = path.split('?');
    const params = new URLSearchParams(qs);
    const from = params.get('from'); const to = params.get('to');
    const dates = [];
    for (let d = new Date(`${from}T12:00:00Z`); d <= new Date(`${to}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      dates.push(d.toISOString().slice(0, 10));
    }
    return { days: dates.map(dayFor) };
  });
});

const strip = (props = {}) => r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={() => {}} {...props} />);

describe('WeekStrip', () => {
  it('makes ONE range request for the whole strip, not one per day', async () => {
    strip();
    await waitFor(() => expect(document.querySelectorAll('.health-weekstrip__cell').length).toBe(7));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(RANGE_PATH);
  });

  it('sets each bar height from the day/budget ratio, clamped at the overshoot cap', async () => {
    strip();
    // 1000 / 2000 = 50% of budget -> 40% of a box whose top is 125%.
    const half = await screen.findByTestId('weekbar-fill-2026-08-28');
    expect(half.style.height).toBe('40%');
    // 2800 / 2000 = 140%, past the cap -> the paint stops at the box top.
    expect(screen.getByTestId(`weekbar-fill-${OVER_DATE}`).style.height).toBe('100%');
  });

  it('hues the bar by status — under vs over', async () => {
    strip();
    await screen.findByTestId('weekbar-fill-2026-08-28');
    expect(screen.getByTestId('weekbar-fill-2026-08-28').className).toMatch(/fill--under/);
    expect(screen.getByTestId(`weekbar-fill-${OVER_DATE}`).className).toMatch(/fill--over/);
  });

  // PRD F7.1, the phase's stated Critical risk: no stacked macro segments in the
  // strip. The previous guard counted `.health-weekstrip__fill` elements and
  // asserted six — which a reviewer defeated in one line by adding segments
  // under a DIFFERENT class name and watching the suite stay green. Counting one
  // class cannot express "nothing is stacked"; the assertion has to be
  // STRUCTURAL, about how many things live inside a bar, whatever they are called.
  it('stacks NOTHING inside a bar — exactly one child, whatever its class', async () => {
    strip();
    await screen.findByTestId('weekbar-fill-2026-08-28');

    const bars = [...document.querySelectorAll('.health-weekstrip__bar')];
    expect(bars).toHaveLength(7);           // one per cell, gap included
    for (const bar of bars) {
      const isGap = bar.classList.contains('health-weekstrip__bar--gap');
      // A gap holds nothing at all; a computed day holds exactly ONE fill. A
      // second child of any name is a stacked segment.
      expect(bar.children.length).toBe(isGap ? 0 : 1);
    }

    // And no cell smuggles extra marks in beside the bar: a cell's bar box holds
    // the reference line and the bar, and nothing else.
    for (const box of document.querySelectorAll('.health-weekstrip__barbox')) {
      expect(box.children.length).toBe(2);
      expect(box.children[0].className).toMatch(/goalline/);
      expect(box.children[1].className).toMatch(/health-weekstrip__bar/);
    }
  });

  // THE honesty pin. A hole in the data and a day someone genuinely logged
  // nothing are different statements and must not render the same way.
  it('a GAP day is hollow — no track, no fill — while a genuine ZERO day keeps a real track and an empty fill', async () => {
    strip();
    await screen.findByTestId(`weekbar-gap-${GAP_DATE}`);

    // Gap: a hollow outlined bar, and NO fill element exists for it at all.
    expect(screen.getByTestId(`weekbar-gap-${GAP_DATE}`).className).toMatch(/bar--gap/);
    expect(screen.queryByTestId(`weekbar-fill-${GAP_DATE}`)).toBeNull();

    // Zero: the equation was computed, so the track is real and the fill exists
    // at zero height. It is NOT rendered as a gap.
    const zeroFill = screen.getByTestId(`weekbar-fill-${ZERO_DATE}`);
    expect(zeroFill.style.height).toBe('0%');
    expect(screen.queryByTestId(`weekbar-gap-${ZERO_DATE}`)).toBeNull();
  });

  it('says "no data" for a gap and a real kcal reading for a zero day', async () => {
    strip();
    await screen.findByTestId(`weekbar-gap-${GAP_DATE}`);
    const cells = [...document.querySelectorAll('.health-weekstrip__cell')];
    const gapCell = cells[2];  // 08-27, 08-28, 08-29
    const zeroCell = cells[3];
    expect(gapCell.getAttribute('aria-label')).toMatch(/no data/);
    expect(gapCell.textContent).toContain('—');
    expect(zeroCell.getAttribute('aria-label')).toMatch(/ate 0 of 2000 kcal/);
    expect(zeroCell.getAttribute('aria-label')).not.toMatch(/no data/);
  });

  it('announces the TRUE percentage even when the paint is clamped, and reconciles it with exercise', async () => {
    strip();
    await screen.findByTestId(`weekbar-fill-${OVER_DATE}`);
    const overCell = [...document.querySelectorAll('.health-weekstrip__cell')]
      .find((c) => c.getAttribute('aria-label')?.includes('2800'));
    const label = overCell.getAttribute('aria-label');
    expect(label).toMatch(/140% of budget/);
    expect(label).toMatch(/over budget/);
    // The reconciling term is always present — the height's denominator and the
    // hue's are different, and a sentence must not assert both without it.
    expect(label).toMatch(/exercise/);
  });

  // I1. The bar's height says food/budget; its hue says the outcome after
  // exercise. A day that ate 114% and still came in under is GREEN above the
  // reference line, which reads as a mistake unless something says otherwise.
  it('marks a cell whose overshoot was offset by exercise, in the cue AND the words', async () => {
    strip({ date: OFFSET_TODAY, today: OFFSET_TODAY });
    const fill = await screen.findByTestId(`weekbar-fill-${OFFSET_DATE}`);
    expect(fill.className).toMatch(/fill--under/);
    expect(fill.className).toMatch(/fill--offset/);

    const cell = fill.closest('.health-weekstrip__cell');
    const label = cell.getAttribute('aria-label');
    expect(label).toMatch(/114% of budget/);
    expect(label).toMatch(/530 kcal exercise/);
    expect(label).toMatch(/281 kcal left/);

    // An ordinary under day in the SAME strip carries no offset cue.
    expect(screen.getByTestId('weekbar-fill-2026-07-24').className).not.toMatch(/fill--offset/);
  });

  // The window always ENDS at the viewed date, so today is in the strip only
  // while you are looking at today. The ring is what says so: on a past date
  // nothing is ringed, which is the difference between "this is today" and
  // "this is the day you have selected".
  it('rings today while viewing today, and rings nothing while viewing a past date', async () => {
    strip();
    await waitFor(() => expect(document.querySelectorAll('.health-weekstrip__cell').length).toBe(7));
    const todayCell = document.querySelector('.health-weekstrip__cell--today');
    expect(todayCell).toBeTruthy();
    expect(todayCell).toBe(document.querySelector('.health-weekstrip__cell--active'));

    resetApiResourceCache();
    strip({ date: '2026-08-31' });
    await waitFor(() => expect(document.querySelectorAll('.health-weekstrip__cell--active').length).toBeGreaterThan(0));
    // The past-date strip ends at 08-31, so 09-02 is not in it and nothing is ringed.
    const strips = document.querySelectorAll('.health-weekstrip');
    expect(strips[1].querySelector('.health-weekstrip__cell--today')).toBeNull();
    expect(strips[1].querySelector('.health-weekstrip__cell--active')).toBeTruthy();
  });

  it('never reaches past today, even when the viewed date somehow has', async () => {
    strip({ date: '2026-12-25', today: '2026-09-02' });
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(apiMock).toHaveBeenCalledWith(RANGE_PATH);
  });

  it('tapping a cell jumps the viewed date', async () => {
    const onDateChange = vi.fn();
    strip({ onDateChange });
    await waitFor(() => expect(document.querySelectorAll('.health-weekstrip__cell').length).toBe(7));
    fireEvent.click(document.querySelectorAll('.health-weekstrip__cell')[0]);
    expect(onDateChange).toHaveBeenCalledWith('2026-08-27');
  });

  it('uses readable weekday names and marks the month boundary', async () => {
    strip();
    await screen.findByText('Thu');
    expect(screen.getByText('Fri')).toBeTruthy();
    expect(screen.getByText('Aug')).toBeTruthy();
    expect(screen.getByText('Sep')).toBeTruthy();
    expect(document.querySelectorAll('.health-weekstrip__cell--month-start')).toHaveLength(1);
  });

  it('selecting a visible day does not move the seven-day window', async () => {
    function Harness() {
      const [date, setDate] = useState('2026-09-02');
      return <WeekStrip date={date} today="2026-09-02" onDateChange={setDate} />;
    }
    r(<Harness />);
    await waitFor(() => expect(document.querySelectorAll('.health-weekstrip__cell')).toHaveLength(7));
    const before = [...document.querySelectorAll('.health-weekstrip__cell')].map((cell) => cell.getAttribute('aria-label'));
    fireEvent.click(document.querySelectorAll('.health-weekstrip__cell')[2]);
    await waitFor(() => expect(document.querySelector('.health-weekstrip__cell--active')).toBe(document.querySelectorAll('.health-weekstrip__cell')[2]));
    const after = [...document.querySelectorAll('.health-weekstrip__cell')].map((cell) => cell.getAttribute('aria-label'));
    expect(after).toEqual(before);
  });

  it('moves by an explicit week and disables forward navigation at today', async () => {
    const onDateChange = vi.fn();
    strip({ onDateChange });
    await screen.findByRole('button', { name: 'Previous week' });
    expect(screen.getByRole('button', { name: 'Next week' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(onDateChange).toHaveBeenCalledWith('2026-08-26');
  });
});
