import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RacePistons from './RacePistons.jsx';

const riders = {
  milo: { userId: 'milo', displayName: 'Milo', cumulativeDistanceM: 1500 },
  felix: { userId: 'felix', displayName: 'Felix', cumulativeDistanceM: 900 }
};

describe('RacePistons', () => {
  it('renders one bar row per rider', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['milo', 'felix']} riders={riders} riderLive={{ milo: {}, felix: {} }} />
    );
    expect(getAllByTestId('piston-row')).toHaveLength(2);
  });

  it('scales bars to the leader so the leader fills the track and the trailer trails', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['milo', 'felix']} riders={riders} riderLive={{ milo: {}, felix: {} }} />
    );
    const [milo, felix] = getAllByTestId('piston-bar');
    // Milo leads (1500) → 100%; Felix (900) → 60% of the leader.
    expect(milo.style.width).toBe('100.00%');
    expect(felix.style.width).toBe('60.00%');
  });

  it('keeps lanes in a fixed order (riderIds), not sorted by distance', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['felix', 'milo']} riders={riders} riderLive={{ milo: {}, felix: {} }} />
    );
    // Felix lane is first even though Milo leads — motion is horizontal, not reordering.
    const dists = getAllByTestId('piston-dist').map((n) => n.textContent);
    expect(dists[0]).toContain('900');
    expect(dists[1]).toContain('1');
  });
});
