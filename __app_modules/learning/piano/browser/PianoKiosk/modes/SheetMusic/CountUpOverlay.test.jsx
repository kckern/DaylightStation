import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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

describe('the count in bars, with the entry drawn in its beat', () => {
  // Santa Claus RH at 120: a ready bar, then 1 2 3 and the pickup on 4.
  const santa = [1, 2, 3, 4, 1, 2, 3].map((beat, index) => ({ bar: index < 4 ? 1 : 2, beat, kind: 'count' }))
    .concat({ bar: 2, beat: 4, kind: 'note' });
  it('groups the boxes by bar and draws the entry as a note box from the first click', () => {
    const { container } = render(<CountUpOverlay active clicks={7} count={1} last={false} slots={santa} />);
    const groups = container.querySelectorAll('.piano-learn-countin__bar');
    expect(groups).toHaveLength(2);
    expect([...groups[0].querySelectorAll('.piano-learn-countin__pip')].map((el) => el.textContent)).toEqual(['1', '2', '3', '4']);
    const note = container.querySelector('.piano-learn-countin__pip.is-note');
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('♩');
    expect(screen.getByText('Play on the ♩')).toBeInTheDocument();
  });
  it('lights the box under the click, across bars', () => {
    const { container } = render(<CountUpOverlay active clicks={7} count={6} last={false} slots={santa} />);
    const current = container.querySelector('.piano-learn-countin__pip.is-current');
    expect(current.textContent).toBe('2');
    expect(current.closest('.piano-learn-countin__bar')).toBe(container.querySelectorAll('.piano-learn-countin__bar')[1]);
  });
  it('a hand that enters later sees a rest where the pickup is', () => {
    const lh = santa.slice(0, 7).concat({ bar: 2, beat: 4, kind: 'rest' }, { bar: 3, beat: 1, kind: 'note' });
    const { container } = render(<CountUpOverlay active clicks={8} count={1} last={false} slots={lh} />);
    expect(container.querySelector('.piano-learn-countin__pip.is-rest').textContent).toBe('𝄽');
    expect(container.querySelectorAll('.piano-learn-countin__bar')).toHaveLength(3);
  });
  it('the rhythm step draws an X in the note box', () => {
    const { container } = render(<CountUpOverlay active clicks={7} count={1} last={false} slots={santa} notehead="x" />);
    expect(container.querySelector('.piano-learn-countin__pip.is-note').textContent).toBe('✕');
  });
});
