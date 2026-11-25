// frontend/src/lib/ui/browserMotion.test.js
import { describe, it, expect, vi } from 'vitest';
import { getReducedMotionQuery, getPreferredScrollBehavior } from './browserMotion.js';

const viewWith = matches => ({ matchMedia: vi.fn(() => ({ matches })) });
const elementIn = view => ({ ownerDocument: { defaultView: view } });

describe('browserMotion', () => {
  it('asks the given window for the reduced-motion query', () => {
    const view = viewWith(true);
    const query = getReducedMotionQuery(view);
    expect(view.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(query.matches).toBe(true);
  });

  it('is undefined without a window or without matchMedia', () => {
    expect(getReducedMotionQuery(undefined)).toBeUndefined();
    expect(getReducedMotionQuery({})).toBeUndefined();
  });

  it('scrolls instantly when the person prefers reduced motion', () => {
    expect(getPreferredScrollBehavior(elementIn(viewWith(true)))).toBe('instant');
  });

  it('scrolls smoothly otherwise, and when there is no way to ask', () => {
    expect(getPreferredScrollBehavior(elementIn(viewWith(false)))).toBe('smooth');
    expect(getPreferredScrollBehavior(elementIn({}))).toBe('smooth');
    expect(getPreferredScrollBehavior(null)).toBe('smooth');
  });

  it('reads the preference live on each call rather than caching it', () => {
    let reduce = false;
    const view = { matchMedia: () => ({ matches: reduce }) };
    const el = elementIn(view);
    expect(getPreferredScrollBehavior(el)).toBe('smooth');
    reduce = true;
    expect(getPreferredScrollBehavior(el)).toBe('instant');
  });

  it('uses the element’s own document window (a real DOM node)', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const spy = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true });
    try {
      expect(getPreferredScrollBehavior(el)).toBe('instant');
    } finally { spy.mockRestore(); el.remove(); }
  });
});
