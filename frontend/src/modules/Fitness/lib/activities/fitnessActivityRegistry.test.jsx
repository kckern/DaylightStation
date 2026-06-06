import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { getActivityDisplay, primaryActivity } from './fitnessActivityRegistry.jsx';

describe('fitnessActivityRegistry', () => {
  it('labels cycle-game by race count (singular/plural)', () => {
    const d = getActivityDisplay('cycle-game');
    expect(d.label(1)).toBe('1 race');
    expect(d.label(13)).toBe('13 races');
  });

  it('exposes an accent color and an overlayKey', () => {
    const d = getActivityDisplay('cycle-game');
    expect(typeof d.accent).toBe('string');
    expect(d.accent).toMatch(/^#/);
    expect(d.overlayKey).toBe('race-bands');
  });

  it('renders a vector Poster (inline svg, no <img>)', () => {
    const d = getActivityDisplay('cycle-game');
    const { container } = render(<d.Poster />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(container.querySelector('img')).toBeNull(); // inline svg, not a rasterized asset
  });

  it('returns null for unknown types (graceful Workout fallback)', () => {
    expect(getActivityDisplay('nope')).toBeNull();
  });

  it('primaryActivity picks the highest-count activity', () => {
    expect(primaryActivity([])).toBeNull();
    expect(primaryActivity([{ type: 'a', count: 2 }, { type: 'b', count: 5 }]).type).toBe('b');
  });
});
