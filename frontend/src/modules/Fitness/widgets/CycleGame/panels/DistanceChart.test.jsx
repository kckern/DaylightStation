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
  it('frames the chart in the fixed window at level 0 (point not pegged to the right)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [10, 20, 30, 40, 50, 60], isGhost: false } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="time" goalM={3000} elapsedS={5} />
    );
    const line = container.querySelector('[data-testid="race-line"]');
    const xs = line.getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
    expect(Math.max(...xs)).toBeLessThan(200);
  });
  it('doubles the Y window when the leader passes 90% of it (distance race)', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 240, distanceSeries: [240], isGhost: false } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={5000} elapsedS={5} />
    );
    const line = container.querySelector('[data-testid="race-line"]');
    const y = parseFloat(line.getAttribute('points').trim().split(',')[1]);
    expect(y).toBeGreaterThan(90);
    expect(y).toBeLessThan(110);
  });
  it('renders decimating gridlines for the current window', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 120, distanceSeries: [120], isGhost: false } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={5000} elapsedS={10} />
    );
    const grid = container.querySelector('[data-testid="chart-grid"]');
    expect(grid).toBeTruthy();
    expect(grid.querySelectorAll('.cycle-race-screen__gridline--y').length).toBeGreaterThanOrEqual(2);
    expect(grid.querySelectorAll('.cycle-race-screen__gridline--x').length).toBeGreaterThanOrEqual(2);
  });
  it('wraps the plotted content in a zoomable group that carries the transition', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [50], isGhost: false } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={5000} elapsedS={5} />
    );
    const g = container.querySelector('[data-testid="chart-zoomable"]');
    expect(g).toBeTruthy();
    expect(g.getAttribute('class')).toContain('cycle-race-screen__zoomable');
  });
});
