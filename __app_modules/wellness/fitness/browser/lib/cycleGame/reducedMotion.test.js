import { describe, it, expect, afterEach, vi } from 'vitest';
import { prefersReducedMotion } from './reducedMotion.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('prefersReducedMotion', () => {
  it('reads the media query', () => {
    const mm = vi.fn(() => ({ matches: true }));
    vi.stubGlobal('matchMedia', mm);
    window.matchMedia = mm;
    expect(prefersReducedMotion()).toBe(true);
    expect(mm).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    window.matchMedia = vi.fn(() => ({ matches: false }));
    expect(prefersReducedMotion()).toBe(false);
  });
  it('is false when matchMedia is missing or throws', () => {
    window.matchMedia = undefined;
    expect(prefersReducedMotion()).toBe(false);
    window.matchMedia = () => { throw new Error('nope'); };
    expect(prefersReducedMotion()).toBe(false);
  });
});
