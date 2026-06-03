import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import SpeedoRow from './SpeedoRow.jsx';

describe('SpeedoRow panel', () => {
  it('renders one speedometer per rider inside the speedos row', () => {
    const { container } = render(<SpeedoRow
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'A', cumulativeDistanceM: 10 }, b: { displayName: 'B', cumulativeDistanceM: 20 } }}
      riderLive={{ a: {}, b: {} }}
      cadenceBands={[]}
    />);
    expect(container.querySelector('.cycle-race-screen__speedos')).not.toBeNull();
    expect(container.querySelectorAll('.cycle-speedometer').length).toBe(2);
  });
});
