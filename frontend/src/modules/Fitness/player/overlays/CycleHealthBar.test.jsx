import React from 'react';
import { render } from '@testing-library/react';
import CycleHealthBar from './CycleHealthBar.jsx';

const litCount = (container) =>
  container.querySelectorAll('.cycle-health-bar__seg--lit').length;

describe('CycleHealthBar', () => {
  it('renders the requested number of segments (default 10)', () => {
    const { container } = render(<CycleHealthBar pct={1} />);
    expect(container.querySelectorAll('.cycle-health-bar__seg')).toHaveLength(10);
  });

  it('lights ceil(pct * segments)', () => {
    const { container } = render(<CycleHealthBar pct={0.62} segments={10} />);
    expect(litCount(container)).toBe(7); // ceil(6.2)
  });

  it('full health lights every segment', () => {
    const { container } = render(<CycleHealthBar pct={1} segments={10} />);
    expect(litCount(container)).toBe(10);
  });

  it('zero health lights nothing and flags locked', () => {
    const { container } = render(<CycleHealthBar pct={0} segments={10} />);
    expect(litCount(container)).toBe(0);
    expect(container.querySelector('.cycle-health-bar--locked')).not.toBeNull();
  });

  it('depletes right-to-left: the rightmost segment goes dark before the leftmost', () => {
    const { container } = render(<CycleHealthBar pct={0.5} segments={10} />);
    const segs = [...container.querySelectorAll('.cycle-health-bar__seg')];
    expect(segs[0].classList.contains('cycle-health-bar__seg--lit')).toBe(true);   // leftmost lit
    expect(segs[9].classList.contains('cycle-health-bar__seg--lit')).toBe(false);  // rightmost dark
  });

  it('exposes a meter role with aria values', () => {
    const { container } = render(<CycleHealthBar pct={0.5} />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter).not.toBeNull();
    expect(meter.getAttribute('aria-valuenow')).toBe('50');
  });

  it('clamps out-of-range pct', () => {
    const { container } = render(<CycleHealthBar pct={1.7} segments={10} />);
    expect(litCount(container)).toBe(10);
  });
});
