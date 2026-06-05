import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SplitsChart from './SplitsChart.jsx';

const riders = {
  felix: { displayName: 'Felix', cumulativeDistanceM: 250, lapSplits: [41, 79] }, // laps: 41, 38
  milo:  { displayName: 'Milo',  cumulativeDistanceM: 250, lapSplits: [43, 85] }  // laps: 43, 42
};

describe('SplitsChart', () => {
  it('renders one column per rider and one row per completed lap', () => {
    const { getAllByTestId } = render(
      <SplitsChart riderIds={['felix','milo']} riders={riders} lapLengthM={100} elapsedS={120} />
    );
    expect(getAllByTestId('splits-rider').length).toBe(2);
    expect(getAllByTestId('splits-lap-row').length).toBe(2);
  });
  it('shows the per-lap delta (not cumulative) for completed laps', () => {
    const { getAllByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }} lapLengthM={100} elapsedS={120} />
    );
    const cells = getAllByTestId('splits-cell').map((c) => c.textContent);
    expect(cells[0]).toContain('0:41');
    expect(cells[1]).toContain('0:38');
  });
  it('renders a current-lap row counting up from the last crossing', () => {
    const { getByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }} lapLengthM={100} elapsedS={100} />
    );
    const cur = getByTestId('splits-current');
    expect(cur.textContent).toContain('0:21'); // 100 - 79
  });
  it("marks each rider's best completed lap", () => {
    const { container } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }} lapLengthM={100} elapsedS={120} />
    );
    const best = container.querySelectorAll('.cg-splits__cell--best');
    expect(best.length).toBe(1);
    expect(best[0].textContent).toContain('0:38');
  });
  it('shows an empty state when laps are disabled', () => {
    const { getByTestId } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: { displayName: 'Felix', cumulativeDistanceM: 50 } }} lapLengthM={0} elapsedS={10} />
    );
    expect(getByTestId('splits-empty')).toBeInTheDocument();
  });
  it('renders without crashing (no -Infinity) when laps are on but no riders yet', () => {
    const { getByTestId } = render(<SplitsChart riderIds={[]} riders={{}} lapLengthM={100} elapsedS={10} />);
    expect(getByTestId('race-splits').textContent).not.toContain('Infinity');
  });
  it('pins the current lap in a tfoot and scrolls completed laps in a tbody (sticky layout)', () => {
    const { container } = render(
      <SplitsChart riderIds={['felix']} riders={{ felix: riders.felix }} lapLengthM={100} elapsedS={120} />
    );
    expect(container.querySelector('tfoot [data-testid="splits-current"]')).not.toBeNull();
    expect(container.querySelectorAll('tbody [data-testid="splits-lap-row"]').length).toBe(2);
    expect(container.querySelector('thead [data-testid="splits-rider"]')).not.toBeNull();
  });
});
