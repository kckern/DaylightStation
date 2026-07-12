import { describe, it, expect } from 'vitest';
import { createDebounce } from '#apps/trigger/guards/debounce.mjs';

describe('createDebounce', () => {
  it('first check passes, repeat within window is debounced', () => {
    const d = createDebounce({ windowMs: 30000 });
    expect(d.check('k', 1000)).toEqual({ debounced: false });
    d.set('k', 1000);
    expect(d.check('k', 5000)).toEqual({ debounced: true, sinceMs: 4000 });
  });
  it('passes again after the window and prunes stale keys', () => {
    const d = createDebounce({ windowMs: 30000 });
    d.set('k', 1000);
    expect(d.check('k', 40000)).toEqual({ debounced: false });
  });
  it('delete clears a key', () => {
    const d = createDebounce({ windowMs: 30000 });
    d.set('k', 1000);
    d.delete('k');
    expect(d.check('k', 2000)).toEqual({ debounced: false });
  });
});
