import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import RacePistons from './RacePistons.jsx';

const riders = {
  user_3: { userId: 'user_3', displayName: 'User_3', cumulativeDistanceM: 1500 },
  user_2: { userId: 'user_2', displayName: 'User_2', cumulativeDistanceM: 900 }
};

describe('RacePistons', () => {
  it('renders one bar row per rider', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['user_3', 'user_2']} riders={riders} riderLive={{ user_3: {}, user_2: {} }} />
    );
    expect(getAllByTestId('piston-row')).toHaveLength(2);
  });

  it('scales bars to the leader so the leader fills the track and the trailer trails', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['user_3', 'user_2']} riders={riders} riderLive={{ user_3: {}, user_2: {} }} />
    );
    const [user_3, user_2] = getAllByTestId('piston-bar');
    // User_3 leads (1500) → 100%; User_2 (900) → 60% of the leader.
    expect(user_3.style.width).toBe('100.00%');
    expect(user_2.style.width).toBe('60.00%');
  });

  it('keeps lanes in a fixed order (riderIds), not sorted by distance', () => {
    const { getAllByTestId } = render(
      <RacePistons riderIds={['user_2', 'user_3']} riders={riders} riderLive={{ user_3: {}, user_2: {} }} />
    );
    // User_2 lane is first even though User_3 leads — motion is horizontal, not reordering.
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
