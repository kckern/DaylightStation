// FitnessMomentum.test.jsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const sessions = [
  { date: '2026-06-24', durationMs: 30 * 60000, startTime: Date.now() - 3600000, participants: { user_2: { displayName: 'User_2' } } },
];
// The real 'sessions' source returns a WRAPPED object, not a bare array — the
// widget must unwrap rawSessions.sessions for minutes to flow through.
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({ useScreenData: () => ({ sessions, total: 1 }) }));
vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ roster: [{ id: 'user_2', name: 'User_2' }, { id: 'kckern', name: 'User_1' }], householdLabel: 'Kern Family' }),
}));

import FitnessMomentum from './FitnessMomentum.jsx';

describe('FitnessMomentum', () => {
  it('renders the household headline and one card per roster member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card').length).toBe(2);
    expect(getByText('User_2')).toBeTruthy();
    expect(getByText('User_1')).toBeTruthy();
  });

  it('unwraps the wrapped sessions source so minutes flow through', () => {
    const { getByText } = render(<FitnessMomentum />);
    // User_2 has a 30-min session in the last 7d → his card shows 30 / 150.
    expect(getByText('30 / 150')).toBeTruthy();
  });
});
