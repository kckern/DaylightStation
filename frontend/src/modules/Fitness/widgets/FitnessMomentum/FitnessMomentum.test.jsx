// FitnessMomentum.test.jsx
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const sessions = [
  { date: '2026-06-24', durationMs: 30 * 60000, startTime: Date.now() - 3600000, participants: { felix: { displayName: 'Felix' } } },
];
// The real 'sessions' source returns a WRAPPED object, not a bare array — the
// widget must unwrap rawSessions.sessions for minutes to flow through.
vi.mock('@/screen-framework/data/ScreenDataProvider.jsx', () => ({ useScreenData: () => ({ sessions, total: 1 }) }));
vi.mock('@/modules/Fitness/FitnessScreenProvider.jsx', () => ({
  useFitnessScreen: () => ({ roster: [{ id: 'felix', name: 'Felix' }, { id: 'kckern', name: 'KC Kern' }], householdLabel: 'Kern Family' }),
}));

import FitnessMomentum from './FitnessMomentum.jsx';

describe('FitnessMomentum', () => {
  it('renders the household headline and one card per roster member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card').length).toBe(2);
    expect(getByText('Felix')).toBeTruthy();
    expect(getByText('KC Kern')).toBeTruthy();
  });

  it('unwraps the wrapped sessions source so minutes flow through', () => {
    const { getByText } = render(<FitnessMomentum />);
    // Felix has a 30-min session in the last 7d → his card shows 30 / 150.
    expect(getByText('30 / 150')).toBeTruthy();
  });
});
