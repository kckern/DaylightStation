import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import CountUpOverlay from './CountUpOverlay.jsx';

describe('CountUpOverlay', () => {
  it('shows the armed form before the first click: every pip unlit, listening cue', () => {
    const { container } = render(<CountUpOverlay active clicks={4} count={0} last={false} />);
    const el = container.querySelector('.piano-learn-countin');
    expect(el).toHaveAttribute('data-armed', 'true');
    expect(el).toHaveAttribute('aria-live', 'polite');
    expect(el.querySelectorAll('.piano-learn-countin__pip')).toHaveLength(4);
    expect(el.querySelectorAll('.piano-learn-countin__pip.is-lit')).toHaveLength(0);
    expect(el.querySelector('.piano-learn-countin__cue')).toHaveTextContent('Listen for the clicks');
  });

  it('counts up 1 2 3 4, accent on the first, and says "next click: play" on the last', () => {
    const { container, rerender } = render(<CountUpOverlay active clicks={4} count={1} last={false} />);
    for (const count of [1, 2, 3, 4]) {
      rerender(<CountUpOverlay active clicks={4} count={count} last={count === 4} />);
      const el = container.querySelector('.piano-learn-countin');
      expect(el).not.toHaveAttribute('data-armed');
      expect(el).toHaveAttribute('data-count', String(count));
      expect(el.querySelectorAll('.piano-learn-countin__pip.is-lit')).toHaveLength(count);
      expect(el.querySelector('.piano-learn-countin__pip.is-current')).toHaveTextContent(String(count));
      expect(el.querySelector('.piano-learn-countin__pip')).toHaveClass('is-accent');
      expect(el.textContent).not.toMatch(/PLAY/);
      expect(el.querySelector('.piano-learn-countin__cue')?.textContent ?? '').toBe(count === 4 ? 'next click: play' : '');
    }
    expect(container.querySelector('.piano-learn-countin')).toHaveAttribute('aria-label', 'Count 4 of 4, next click: play');
  });

  it('renders nothing when inactive', () => {
    const { container } = render(<CountUpOverlay active={false} clicks={4} count={2} last={false} />);
    expect(container.querySelector('.piano-learn-countin')).toBeNull();
  });
});
