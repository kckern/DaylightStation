import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import DistanceChart from './DistanceChart.jsx';

describe('DistanceChart panel', () => {
  it('renders one lane line per rider', () => {
    const { container } = render(<DistanceChart
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'A', cumulativeDistanceM: 1500, distanceSeries: [500, 1000, 1500] }, b: { displayName: 'B', cumulativeDistanceM: 900, distanceSeries: [300, 600, 900] } }}
      riderLive={{ a: {}, b: {} }}
      winCondition="distance" goalM={3000}
    />);
    expect(container.querySelectorAll('[data-testid="race-line"]').length).toBe(2);
  });
});
