import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import RaceResults from './RaceResults.jsx';

const standings = [
  { userId: 'user_3', placement: 1, finishTimeS: 252, distanceM: 3000 },
  { userId: 'user_2', placement: 2, finishTimeS: null, distanceM: 2710 }
];
const riders = {
  user_3: { displayName: 'User_3' },
  user_2: { displayName: 'User_2' }
};

describe('RaceResults', () => {
  it('renders a row per standing in placement order with names', () => {
    const { getAllByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} />);
    const rows = getAllByTestId('result-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('User_3');
    expect(rows[0].textContent).toContain('1');
  });
  it('marks DNF riders', () => {
    const { getByTestId } = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={['user_2']} />);
    expect(getByTestId('result-row-user_2').textContent).toContain('DNF');
  });
  it('shows time for distance races and distance for time races', () => {
    const dist = render(<RaceResults standings={standings} riders={riders} winCondition="distance" dnf={[]} />);
    expect(within(dist.container).getByTestId('result-row-user_3').textContent).toContain('4:12'); // 252s
    const time = render(<RaceResults standings={standings} riders={riders} winCondition="time" dnf={[]} />);
    expect(within(time.container).getByTestId('result-row-user_3').textContent).toContain('3.00 km'); // 3000 m
  });
});
