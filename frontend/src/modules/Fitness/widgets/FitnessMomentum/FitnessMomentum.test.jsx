// FitnessMomentum.test.jsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Recent session with a zone breakdown for KC. The real 'sessions' source returns
// a WRAPPED object, not a bare array — the widget must unwrap rawSessions.sessions.
const sessions = [
  {
    startTime: Date.now() - 3600000,
    durationMs: 30 * 60000,
    participants: { kckern: { displayName: 'KC Kern', zoneMinutes: { active: 20, warm: 10, cool: 5 } } },
  },
];
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({ useScreenData: () => ({ sessions, total: 1 }) }));
vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({
    // kckern carries a group_label so the resolver should render "Dad", not "KC Kern".
    roster: [{ id: 'kckern', name: 'KC Kern', group_label: 'Dad' }, { id: 'felix', name: 'Felix' }],
    householdLabel: 'Kern Family',
    windowDays: 7,
    compareWeeks: 4,
  }),
}));

import FitnessMomentum from './FitnessMomentum.jsx';

describe('FitnessMomentum', () => {
  it('renders the household headline with the configured window and one card per member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(getByText(/last 7 days/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card').length).toBe(2);
  });

  it('resolves names through DisplayNameResolver (group label → "Dad")', () => {
    const { getByText, queryByText } = render(<FitnessMomentum />);
    expect(getByText('Dad')).toBeTruthy();
    expect(queryByText('KC Kern')).toBeNull();
    expect(getByText('Felix')).toBeTruthy();
  });

  it('draws compareWeeks bars per person with the current week highlighted', () => {
    const { container } = render(<FitnessMomentum />);
    // 2 members × 4 weeks = 8 bars; one current bar per member.
    expect(container.querySelectorAll('.fitness-momentum__weekbar').length).toBe(8);
    expect(container.querySelectorAll('.fitness-momentum__weekbar.is-current').length).toBe(2);
  });

  it('shows the credited current-week minutes (cool omitted) on the top axis, no percentage', () => {
    const { getByText, container } = render(<FitnessMomentum />);
    // 20 active + 10 warm = 30 credited (the 5 cool minutes earn no credit).
    expect(getByText('30')).toBeTruthy();
    expect(container.textContent).not.toMatch(/%/);
    // The per-card bottom total label is gone (the household headline keeps "min this week").
    expect(container.querySelectorAll('.fitness-momentum__min').length).toBe(0);
  });
});
