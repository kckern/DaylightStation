import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

const sessions = [{
  startTime: Date.now() - 3_600_000,
  totalRings: 300,
  participants: {
    user_1: {
      displayName: 'User_1',
      rings: 300,
      zoneMinutes: { active: 20, warm: 10, cool: 5 },
    },
  },
}];
vi.mock('@/screen-framework/data/useScreenData.js', () => ({
  useScreenData: () => ({ sessions, total: 1 }),
}));
vi.mock('@/modules/Fitness/useFitnessScreen.js', () => ({
  useFitnessScreen: () => ({
    roster: [
      { id: 'user_1', name: 'User_1', group_label: 'Dad' },
      { id: 'user_2', name: 'User_2' },
    ],
    householdLabel: 'Kern Family',
    compareWeeks: 4,
    zoneRingRates: { active: 1, warm: 2, hot: 3, fire: 5 },
  }),
}));

import FitnessMomentum from './FitnessMomentum.jsx';

describe('FitnessMomentum', () => {
  it('labels the hard Monday window and renders one card per member', () => {
    const { container, getByText } = render(<FitnessMomentum />);
    expect(getByText(/Kern Family/)).toBeTruthy();
    expect(getByText(/Monday–today/)).toBeTruthy();
    expect(container.querySelectorAll('.fitness-momentum__card')).toHaveLength(2);
  });

  it('resolves names through DisplayNameResolver (group label → Dad)', () => {
    const { getByText, queryByText } = render(<FitnessMomentum />);
    expect(getByText('Dad')).toBeTruthy();
    expect(queryByText('User_1')).toBeNull();
    expect(getByText('User_2')).toBeTruthy();
  });

  it('draws four weekly bars per person with the current week highlighted', () => {
    const { container } = render(<FitnessMomentum />);
    expect(container.querySelectorAll('.fitness-momentum__weekbar')).toHaveLength(8);
    expect(container.querySelectorAll('.fitness-momentum__weekbar.is-current')).toHaveLength(2);
  });

  it('shows rings as the primary metric with the canonical icon', () => {
    const { container } = render(<FitnessMomentum />);
    expect(container.querySelector('.fitness-momentum__house-rings').textContent).toContain('300');
    expect(container.querySelector('.fitness-momentum__house-rings .ring-icon')).toBeTruthy();
    expect(container.querySelector('.fitness-momentum__weekbar[title="300 rings"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/min this week|last 7 days/);
  });
});
