import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 1000 },
  b: { displayName: 'B', cumulativeDistanceM: 940 }
};
const topPct = (el) => parseFloat(el.style.top);

describe('PovGrid', () => {
  it('renders the road, a lane marker per rider, and metre gridlines', () => {
    const { getAllByTestId, getByTestId } = render(
      <PovGrid riderIds={['a','b']} riders={riders} riderLive={{ a:{}, b:{} }} />
    );
    expect(getByTestId('pov-road')).toBeInTheDocument();
    expect(getAllByTestId('pov-marker').length).toBe(2);
    expect(getByTestId('pov-grid').querySelectorAll('.cg-pov__hline').length).toBeGreaterThan(0);
  });
  it('places the leader nearer the top (far) than the trailer', () => {
    const { getAllByTestId } = render(
      <PovGrid riderIds={['a','b']} riders={riders} riderLive={{ a:{}, b:{} }} />
    );
    const [a, b] = getAllByTestId('pov-marker'); // DOM order follows riderIds [a,b]
    expect(topPct(a)).toBeLessThan(topPct(b)); // leader 'a' higher up (smaller top)
  });
});
