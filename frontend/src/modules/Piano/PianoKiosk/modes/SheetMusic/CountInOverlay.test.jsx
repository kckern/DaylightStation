import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CountInOverlay from './CountInOverlay.jsx';

describe('CountInOverlay', () => {
  it('counts down with an unambiguous live announcement and draining progress', () => {
    const { container, rerender } = render(<CountInOverlay active remaining={4} progress={1} />);
    for (const [remaining, progress] of [[4, 1], [3, 0.75], [2, 0.5], [1, 0.25]]) {
      rerender(<CountInOverlay active remaining={remaining} progress={progress} />);
      const el = container.querySelector('.piano-score-countin');
      expect(el).toHaveAttribute('aria-label', `Starting in ${remaining}`);
      expect(el).toHaveAttribute('aria-live', 'polite');
      expect(el.querySelector('.piano-score-countin__beat')).toHaveTextContent(String(remaining));
      expect(el.style.getPropertyValue('--countdown-progress')).toBe(String(progress));
      expect(el.textContent).not.toMatch(/Count in, beat/);
    }
  });

  it('announces PLAY once through stable rerenders and removes the finished overlay', () => {
    const { container, rerender } = render(<CountInOverlay active remaining={1} progress={0.1} />);
    rerender(<CountInOverlay active remaining={0} progress={0} play />);
    const live = container.querySelector('[aria-live]');
    expect(live).toHaveAttribute('aria-label', 'PLAY');
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(live.querySelector('.piano-score-countin__announcement')).toHaveTextContent('PLAY');
    expect(live.querySelector('.piano-score-countin__beat')).toHaveAttribute('aria-hidden', 'true');
    rerender(<CountInOverlay active remaining={0} progress={0} play />);
    expect(container.querySelector('[aria-live]')).toBe(live);
    rerender(<CountInOverlay active={false} remaining={0} progress={0} play />);
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('renders nothing when inactive', () => {
    const { container } = render(<CountInOverlay active={false} beat={2} />);
    expect(container.querySelector('.piano-score-countin')).toBeNull();
  });

  it('keeps unchanged score-player callers visible', () => {
    const { container } = render(<CountInOverlay active beat={3} />);
    expect(container.querySelector('.piano-score-countin__beat')).toHaveTextContent('3');
  });
});
