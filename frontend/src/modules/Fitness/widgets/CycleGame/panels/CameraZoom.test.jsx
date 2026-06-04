import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CameraZoom, { framePositions } from './CameraZoom.jsx';

describe('CameraZoom framing', () => {
  it('normalizes riders to fill the framed band (trailing = 15%, leader = 85%)', () => {
    const pos = framePositions([
      { id: 'a', distanceM: 980 }, { id: 'b', distanceM: 1000 }
    ]);
    expect(pos.find((p) => p.id === 'b').xPct).toBeCloseTo(85, 0);
    expect(pos.find((p) => p.id === 'a').xPct).toBeCloseTo(15, 0);
  });
  it('centers everyone when all distances are equal (no divide-by-zero)', () => {
    const pos = framePositions([{ id: 'a', distanceM: 500 }, { id: 'b', distanceM: 500 }]);
    expect(pos.every((p) => p.xPct === 50)).toBe(true);
  });
});

describe('framePositions — framing margin', () => {
  it('insets the trailing rider to 15% and the leader to 85%', () => {
    const out = framePositions([
      { id: 'a', distanceM: 0 },
      { id: 'b', distanceM: 100 }
    ]);
    const a = out.find((p) => p.id === 'a');
    const b = out.find((p) => p.id === 'b');
    expect(a.xPct).toBeCloseTo(15, 5);
    expect(b.xPct).toBeCloseTo(85, 5);
  });

  it('puts a mid rider proportionally inside the framed band', () => {
    const out = framePositions([
      { id: 'a', distanceM: 0 },
      { id: 'b', distanceM: 50 },
      { id: 'c', distanceM: 100 }
    ]);
    expect(out.find((p) => p.id === 'b').xPct).toBeCloseTo(50, 5);
  });

  it('centers everyone at 50% when there is no spread', () => {
    const out = framePositions([
      { id: 'a', distanceM: 40 },
      { id: 'b', distanceM: 40 }
    ]);
    expect(out.every((p) => p.xPct === 50)).toBe(true);
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
