import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOAST_DURATION_MS,
  DEFAULT_TOAST_VARIANT,
  normalizeToast,
  dismissMatches,
} from './fitnessToastSlot.js';

describe('fitnessToastSlot', () => {
  it('normalizeToast assigns the id and preserves provided fields', () => {
    const out = normalizeToast({ title: 'Felix', subtitle: 'is riding', durationMs: 2000, variant: 'success' }, 7);
    expect(out).toEqual({ id: 7, title: 'Felix', subtitle: 'is riding', durationMs: 2000, variant: 'success' });
  });

  it('normalizeToast applies default duration and variant when omitted', () => {
    const out = normalizeToast({ title: 'Hi' }, 1);
    expect(out.id).toBe(1);
    expect(out.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
    expect(out.variant).toBe(DEFAULT_TOAST_VARIANT);
  });

  it('normalizeToast ignores a non-finite durationMs and uses the default', () => {
    const out = normalizeToast({ title: 'Hi', durationMs: 'soon' }, 1);
    expect(out.durationMs).toBe(DEFAULT_TOAST_DURATION_MS);
  });

  it('dismissMatches is true only when the current toast id matches', () => {
    expect(dismissMatches({ id: 5 }, 5)).toBe(true);
    expect(dismissMatches({ id: 5 }, 6)).toBe(false);
    expect(dismissMatches(null, 5)).toBe(false);
  });
});
