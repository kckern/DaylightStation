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
    expect(container.querySelectorAll('.cg-pov__hline').length).toBe(50); // fixed 10 m pool, keyed by slot
    expect(container.querySelectorAll('.cg-pov__hline--major').length).toBe(10); // a major every 50 m
    expect(container.querySelector('.cg-pov__fan')).toBeTruthy();
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });
  it('never renders a rider still at 0 m (they would anchor the zoom scale)', () => {
    const field = {
      a: { displayName: 'A', cumulativeDistanceM: 500 },
      b: { displayName: 'B', cumulativeDistanceM: 0 },   // never moved
      c: { displayName: 'C', cumulativeDistanceM: 120 }
    };
    const { getAllByTestId, container } = render(
      <PovGrid riderIds={['a', 'b', 'c']} riders={field} riderLive={{}} />
    );
    expect(getAllByTestId('pov-marker')).toHaveLength(2);            // a + c, not b
    expect(container.querySelectorAll('.cg-pov__fan line').length).toBe(2); // fan lines match
  });

  it('renders nothing for the field at the start when no one has moved', () => {
    const field = { a: { displayName: 'A', cumulativeDistanceM: 0 }, b: { displayName: 'B', cumulativeDistanceM: 0 } };
    const { queryAllByTestId } = render(<PovGrid riderIds={['a', 'b']} riders={field} riderLive={{}} />);
    expect(queryAllByTestId('pov-marker')).toHaveLength(0);
  });

  it('does not animate layout-triggering properties (no top/left transitions)', () => {
    const { container } = render(<PovGrid riderIds={['a']} riders={{ a: riders.a }} riderLive={{}} />);
    const hline = container.querySelector('.cg-pov__hline');
    expect(hline.style.top).toBe('');
    expect(hline.style.left).toBe('');
  });
});
