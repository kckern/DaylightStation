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

  it('pins the leader near the right (88%) and frames the trailer by its metric gap (~25%)', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['milo', 'felix']} riders={riders} riderLive={{ milo: {}, felix: {} }} />
    );
    const [milo, felix] = getAllByTestId('piston-bar');
    // Leader-anchored zoom: Milo (leader) pinned at the right pad; Felix framed near
    // home (25%) on the first frame, NOT a fraction of the leader's total distance.
    expect(milo.style.width).toBe('88.00%');
    expect(parseFloat(felix.style.width)).toBeGreaterThan(20);
    expect(parseFloat(felix.style.width)).toBeLessThan(40);
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

describe('RacePistons — ghost tip avatar carries the cg-ghost treatment', () => {
  it('wraps a ghost rider tip avatar in .cg-ghost', () => {
    const { container } = render(
      <RacePistons
        riderIds={['g']}
        riders={{ g: { displayName: 'Ann 👻', isGhost: true, cumulativeDistanceM: 120 } }}
        riderLive={{ g: {} }}
      />
    );
    const head = container.querySelector('.cg-pistons__head');
    expect(head).not.toBeNull();
    expect(head.querySelector('.cg-ghost')).not.toBeNull();
  });

  it('does NOT wrap a live (non-ghost) rider in .cg-ghost', () => {
    const { container } = render(
      <RacePistons
        riderIds={['h']}
        riders={{ h: { displayName: 'Bob', isGhost: false, cumulativeDistanceM: 120 } }}
        riderLive={{ h: {} }}
      />
    );
    expect(container.querySelector('.cg-pistons__head .cg-ghost')).toBeNull();
  });
});
