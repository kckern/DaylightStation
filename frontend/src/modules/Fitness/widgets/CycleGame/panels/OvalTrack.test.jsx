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
      progress={{ a: 0.1, b: 0.6 }}
    />);
    expect(screen.getAllByTestId('oval-marker')).toHaveLength(2);
  });
});

describe('OvalTrack — marker positioned via CSS transform property (animatable on FF)', () => {
  it('sets an inline style transform and NOT the SVG transform attribute', () => {
    const { getAllByTestId } = render(
      <OvalTrack
        riderIds={['a']}
        riders={{ a: { displayName: 'Ann' } }}
        progress={{ a: 0.25 }}
      />
    );
    const marker = getAllByTestId('oval-marker')[0];
    expect(marker.getAttribute('transform')).toBeNull();
    expect(marker.style.transform).toMatch(/translate\(/);
  });
});

describe('OvalTrack lap counter', () => {
  it('renders the lap label in the center when provided', () => {
    const { getByTestId } = render(
      <OvalTrack riderIds={['a']} riders={{ a: { displayName: 'A' } }} progress={{ a: 0.4 }} lapLabel="Lap 3" />
    );
    expect(getByTestId('oval-lap-label').textContent).toBe('Lap 3');
  });
  it('omits the lap label when not provided', () => {
    const { queryByTestId } = render(
      <OvalTrack riderIds={['a']} riders={{ a: { displayName: 'A' } }} progress={{ a: 0.4 }} />
    );
    expect(queryByTestId('oval-lap-label')).toBeNull();
  });
});
