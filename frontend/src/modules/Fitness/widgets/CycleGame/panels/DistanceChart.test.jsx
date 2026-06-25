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
    // 240 m is past 90% of the 150 m base window, so it doubles to 300 m: the
    // leader lands at ~80% height (well off the top padding it would peg to if the
    // window had NOT grown), not clamped at the goal line.
    expect(y).toBeGreaterThan(40);
    expect(y).toBeLessThan(100);
  });
  it('pins the goal line to the top of the chart for a short distance race', () => {
    // goal (100 m) is below the 150 m base window, so the window caps at the goal and
    // the goal line lands at the top inset (PAD_T = 22), not mid-chart.
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 40, distanceSeries: [40], isGhost: false } };
    const { container } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={100} elapsedS={5} />
    );
    const goal = container.querySelector('.cycle-race-screen__goal');
    expect(goal).toBeTruthy();
    const y1 = parseFloat(goal.getAttribute('y1'));
    expect(y1).toBeLessThanOrEqual(30); // near the top inset, not ~⅓ down
  });

  it('hides the goal line + label until the Y window has zoomed out to the goal', () => {
    // leader at 240 m of a 5 km goal → window is ~300 m (zoomed in), nowhere near goal.
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 240, distanceSeries: [240], isGhost: false } };
    const { container, queryByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={5000} elapsedS={5} />
    );
    expect(container.querySelector('.cycle-race-screen__goal')).toBeNull();
    expect(queryByTestId('chart-goal-label')).toBeNull();
  });
  it('shows + labels the goal line once the window reaches the goal', () => {
    const riders = { a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 40, distanceSeries: [40], isGhost: false } };
    const { container, getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={riders} riderLive={{ a: {} }}
        winCondition="distance" goalM={100} elapsedS={5} />
    );
    expect(container.querySelector('.cycle-race-screen__goal')).toBeTruthy();
    expect(getByTestId('chart-goal-label').textContent).toContain('Target');
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
  it('anchors the vertical scale at the start line so the slowest rider is not pinned to the floor', () => {
    // Two riders bunched near the front (triggers log mode) + one far-back rider.
    // Old behaviour anchored the bottom of the scale to the trailing rider, so the
    // slowest rider mapped to frac 0 (the bottom axis). Zero-anchored, they sit well
    // above the floor, reflecting their true ~20% progress.
    const riders = {
      lead:   { displayName: 'L', cumulativeDistanceM: 2500, distanceSeries: [2500] },
      second: { displayName: 'S', cumulativeDistanceM: 2480, distanceSeries: [2480] },
      slow:   { displayName: 'W', cumulativeDistanceM: 500,  distanceSeries: [500]  },
    };
    const { container } = render(
      <DistanceChart riderIds={['lead', 'second', 'slow']} riders={riders}
        riderLive={{ lead: {}, second: {}, slow: {} }}
        winCondition="distance" goalM={5000} elapsedS={1} />
    );
    const lines = container.querySelectorAll('[data-testid="race-line"]');
    const slowY = parseFloat(lines[2].getAttribute('points').trim().split(',')[1]);
    const floorY = 200 - 22; // H - PAD_B = the bottom axis
    expect(slowY).toBeLessThan(floorY - 12); // clearly off the bottom, not flat-lined
  });
  it('freezes a finished rider’s lane at the goal-crossing time (does not crawl right)', () => {
    // Rider A crosses the 1000 m goal at sample index 3, then the engine keeps pushing
    // goal-clamped samples while rider B (still racing) plays on. A's lane must stop at
    // index 3's x; B's lane extends to the latest sample.
    const aSeries = [400, 700, 950, 1000, 1000, 1000, 1000];
    const bSeries = [200, 350, 480, 540, 580, 600, 600];
    const riders = {
      a: { displayName: 'A', cumulativeDistanceM: 1000, finishTimeS: 3, distanceSeries: aSeries },
      b: { displayName: 'B', cumulativeDistanceM: 600, distanceSeries: bSeries },
    };
    const { container } = render(
      <DistanceChart riderIds={['a', 'b']} riders={riders}
        riderLive={{ a: {}, b: {} }} winCondition="distance" goalM={1000} elapsedS={6} />
    );
    const lines = container.querySelectorAll('[data-testid="race-line"]');
    const aXs = lines[0].getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
    const bXs = lines[1].getAttribute('points').trim().split(' ').map((p) => parseFloat(p.split(',')[0]));
    // A plots exactly 4 points (indices 0..3) and stops left of still-racing B.
    expect(aXs.length).toBe(4);
    expect(Math.max(...aXs)).toBeLessThan(Math.max(...bXs));
  });
  it('renders a header strip with the clock and goal label', () => {
    const { getByTestId } = render(
      <DistanceChart riderIds={['a']} riders={{ a: { userId: 'a', displayName: 'A', cumulativeDistanceM: 50, distanceSeries: [50] } }}
        riderLive={{ a: {} }} winCondition="time" goalM={3000} elapsedS={5}
        clockSeconds={55} maxDistanceM={50} />
    );
    const hdr = getByTestId('chart-header');
    expect(hdr.textContent).toContain('0:55');
    expect(hdr.textContent.toLowerCase()).toContain('time left');
  });
});
