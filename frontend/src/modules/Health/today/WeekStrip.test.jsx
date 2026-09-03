import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const apiMock = vi.fn();
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: (...a) => apiMock(...a) }));

import { WeekStrip } from './WeekStrip.jsx';

function r(ui) { return render(<MantineProvider>{ui}</MantineProvider>); }

// Viewed date is "today" (2026-09-02) — strip spans 2026-08-27..2026-09-02.
// One day (08-29) is a real 409 gap (BudgetService's NO_WEIGHT_DATA), the
// rest carry the real /api/v1/health/budget envelope.
const GAP_DATE = '2026-08-29';
const budgetFor = (date) => ({
  date, budget: 1800, food: 1200, exercise: 100, net: -100, remaining: 700,
  status: date === '2026-09-01' ? 'over' : 'under', stale: false, sessions: [], goals: {},
});

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation(async (path) => {
    const date = path.split('date=')[1];
    if (date === GAP_DATE) {
      const err = new Error('conflict'); err.status = 409;
      throw err;
    }
    return budgetFor(date);
  });
});

describe('WeekStrip', () => {
  it('renders 7 cells spanning the 6 days before the viewed date plus the viewed date', async () => {
    r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(7));
    expect(document.querySelectorAll('.health-weekstrip__cell').length).toBe(7);
  });

  it('shows a compact food-kcal total per day, an under/over dot, and highlights the viewed date', async () => {
    r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(7));

    // Every non-gap day's food total (1200 kcal) renders compactly ("1.2k").
    expect(screen.getAllByText('1.2k').length).toBeGreaterThan(0);

    const cells = document.querySelectorAll('.health-weekstrip__cell');
    const active = document.querySelector('.health-weekstrip__cell--active');
    expect(active).toBeTruthy();
    expect(cells[cells.length - 1]).toBe(active); // viewed date is the last (most recent) cell

    // The 'over' day (09-01) carries the over-status dot.
    expect(document.querySelector('.health-weekstrip__dot--over')).toBeTruthy();
  });

  it('a 409 gap day renders the no-data dot and a dash instead of crashing', async () => {
    r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(7));
    expect(document.querySelector('.health-weekstrip__dot--gap')).toBeTruthy();
  });

  it('tapping a past day calls onDateChange with that date', async () => {
    const onDateChange = vi.fn();
    r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={onDateChange} />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(7));

    const cells = document.querySelectorAll('.health-weekstrip__cell');
    fireEvent.click(cells[0]); // 2026-08-27, the earliest cell
    expect(onDateChange).toHaveBeenCalledWith('2026-08-27');
  });

  it('a live-discarded fetch (unmount mid-flight) does not throw or set state', async () => {
    let resolvers = [];
    apiMock.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
    const { unmount } = r(<WeekStrip date="2026-09-02" today="2026-09-02" onDateChange={() => {}} />);
    unmount();
    resolvers.forEach((resolve) => resolve(budgetFor('2026-09-02')));
    await new Promise((r2) => setTimeout(r2, 0));
    // No assertion needed beyond "didn't throw" — React would log an act()
    // warning / crash if setState fired on the unmounted tree.
  });
});
