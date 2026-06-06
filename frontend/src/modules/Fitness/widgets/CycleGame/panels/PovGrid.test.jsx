import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 500 },
  b: { displayName: 'B', cumulativeDistanceM: 400 }
};

describe('PovGrid', () => {
  it('renders the road container, a recycled hline pool, the lane fan, and one marker per rider', () => {
    const { getByTestId, getAllByTestId, container } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />
    );
    expect(getByTestId('race-pov')).toBeInTheDocument();
    expect(getByTestId('pov-grid')).toBeInTheDocument();
    expect(container.querySelectorAll('.cg-pov__hline').length).toBe(24); // fixed pool, keyed by slot
    expect(container.querySelector('.cg-pov__fan')).toBeTruthy();
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });
  it('does not animate layout-triggering properties (no top/left transitions)', () => {
    const { container } = render(<PovGrid riderIds={['a']} riders={{ a: riders.a }} riderLive={{}} />);
    const hline = container.querySelector('.cg-pov__hline');
    expect(hline.style.top).toBe('');
    expect(hline.style.left).toBe('');
  });
});
