import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraZoom, { framePositions } from './CameraZoom.jsx';

describe('CameraZoom framing', () => {
  it('normalizes riders to fill the frame (min distance = 0%, leader = 100%)', () => {
    const pos = framePositions([
      { id: 'a', distanceM: 980 }, { id: 'b', distanceM: 1000 }
    ]);
    expect(pos.find((p) => p.id === 'b').xPct).toBeCloseTo(100, 0);
    expect(pos.find((p) => p.id === 'a').xPct).toBeCloseTo(0, 0);
  });
  it('centers everyone when all distances are equal (no divide-by-zero)', () => {
    const pos = framePositions([{ id: 'a', distanceM: 500 }, { id: 'b', distanceM: 500 }]);
    expect(pos.every((p) => p.xPct === 50)).toBe(true);
  });
});

describe('CameraZoom render', () => {
  it('renders a grid backdrop and a marker per framed rider', () => {
    render(<CameraZoom
      riders={{ a: { displayName: 'Ann', cumulativeDistanceM: 980 }, b: { displayName: 'Bob', cumulativeDistanceM: 1000 } }}
      riderIds={['a', 'b']} riderLive={{ a: {}, b: {} }}
    />);
    expect(screen.getByTestId('camera-grid')).toBeInTheDocument();
    expect(screen.getAllByTestId('camera-marker')).toHaveLength(2);
  });
});
