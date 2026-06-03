import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import OvalTrack, { ovalPoint } from './OvalTrack.jsx';

describe('OvalTrack geometry (start at top, clockwise)', () => {
  it('maps lapProgress to oval positions', () => {
    const top = ovalPoint(0, 100, 50);
    expect(top.x).toBeCloseTo(0, 5);
    expect(top.y).toBeCloseTo(-50, 5);     // top (y-up negative)
    const right = ovalPoint(0.25, 100, 50);
    expect(right.x).toBeCloseTo(100, 5);   // quarter lap → right side
    expect(right.y).toBeCloseTo(0, 5);
    const bottom = ovalPoint(0.5, 100, 50);
    expect(bottom.x).toBeCloseTo(0, 5);
    expect(bottom.y).toBeCloseTo(50, 5);   // half lap → bottom
  });
});

describe('OvalTrack render', () => {
  it('renders one avatar marker per rider', () => {
    render(<OvalTrack
      riderIds={['a', 'b']}
      riders={{ a: { displayName: 'Ann' }, b: { displayName: 'Bob' } }}
      riderLive={{ a: {}, b: {} }}
      lapProgress={{ a: 0.1, b: 0.6 }}
    />);
    expect(screen.getAllByTestId('oval-marker')).toHaveLength(2);
  });
});
