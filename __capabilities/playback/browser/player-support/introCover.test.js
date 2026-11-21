import { describe, it, expect, vi } from 'vitest';
import { setIntroCovering, isIntroCovering, subscribeIntroCover } from './introCover.js';

describe('introCover', () => {
  it('notifies subscribers on change only', () => {
    const cb = vi.fn();
    const off = subscribeIntroCover(cb);
    setIntroCovering(true); setIntroCovering(true);
    expect(isIntroCovering()).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    setIntroCovering(false);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setIntroCovering(true);
    expect(cb).toHaveBeenCalledTimes(2);
    setIntroCovering(false);
  });
});
