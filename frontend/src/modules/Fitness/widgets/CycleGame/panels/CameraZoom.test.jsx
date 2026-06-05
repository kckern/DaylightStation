import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraZoom from './CameraZoom.jsx';

const leftPct = (el) => parseFloat(el.style.left);

describe('CameraZoom (leader-anchored)', () => {
  it('renders a grid backdrop and a marker per rider', () => {
    render(<CameraZoom
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 980 }, b: { displayName: 'Bob', cumulativeDistanceM: 1000 } }}
      riderLive={{ a: {}, b: {} }}
    />);
    expect(screen.getByTestId('camera-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('camera-marker')).toHaveLength(2);
  });

  it('pins the leader near the right and frames the trailing rider toward home (~25%)', () => {
    render(<CameraZoom
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 940 }, b: { displayName: 'Bob', cumulativeDistanceM: 1000 } }}
      riderLive={{ a: {}, b: {} }}
    />);
    const [a, b] = screen.getAllByTestId('camera-marker'); // DOM order follows riderIds [a,b]
    expect(leftPct(b)).toBeGreaterThan(80);   // leader pinned near 88%
    expect(leftPct(a)).toBeGreaterThan(20);   // trailing framed near home 25%
    expect(leftPct(a)).toBeLessThan(40);
  });

  it('draws fixed-metre grid lines', () => {
    render(<CameraZoom
      riderIds={['a', 'b']}
      riders={{ a: { cumulativeDistanceM: 940 }, b: { cumulativeDistanceM: 1000 } }}
      riderLive={{ a: {}, b: {} }}
    />);
    expect(screen.getByTestId('camera-grid').querySelectorAll('.cg-camera-zoom__gridline').length).toBeGreaterThanOrEqual(1);
  });
});
