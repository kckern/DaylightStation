import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PovGrid from './PovGrid.jsx';

const riders = {
  a: { displayName: 'A', cumulativeDistanceM: 500 },
  b: { displayName: 'B', cumulativeDistanceM: 400 }
};

describe('PovGrid', () => {
  it('renders the canvas road and one avatar per moved rider', () => {
    const { getByTestId, getAllByTestId, container } = render(
      <PovGrid riderIds={['a', 'b']} riders={riders} riderLive={{}} />
    );
    expect(getByTestId('race-pov')).toBeInTheDocument();
    expect(container.querySelector('canvas.cg-pov__canvas')).toBeTruthy();
    expect(container.querySelector('.cg-pov__avatars')).toBeTruthy();
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });

  it('never renders a rider still at 0 m (they would anchor the zoom scale)', () => {
    const field = {
      a: { displayName: 'A', cumulativeDistanceM: 500 },
      b: { displayName: 'B', cumulativeDistanceM: 0 },
      c: { displayName: 'C', cumulativeDistanceM: 120 }
    };
    const { getAllByTestId } = render(<PovGrid riderIds={['a', 'b', 'c']} riders={field} riderLive={{}} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(2);
  });

  it('renders no avatars at the start when no one has moved', () => {
    const field = { a: { displayName: 'A', cumulativeDistanceM: 0 }, b: { displayName: 'B', cumulativeDistanceM: 0 } };
    const { queryAllByTestId } = render(<PovGrid riderIds={['a', 'b']} riders={field} riderLive={{}} />);
    expect(queryAllByTestId('pov-marker')).toHaveLength(0);
  });

  it('excludes DNF riders from the course entirely (riderLive[id].dnf)', () => {
    const field = {
      a: { displayName: 'A', cumulativeDistanceM: 500 },
      b: { displayName: 'B', cumulativeDistanceM: 300 }, // moved, but DNF
      c: { displayName: 'C', cumulativeDistanceM: 120 }
    };
    const live = { b: { dnf: true } };
    const { getAllByTestId } = render(<PovGrid riderIds={['a', 'b', 'c']} riders={field} riderLive={live} />);
    expect(getAllByTestId('pov-marker')).toHaveLength(2); // a + c, not the DNF'd b
  });
});
