import { describe, it, expect } from 'vitest';
import { withLoopAlias } from './loopAlias.js';

describe('withLoopAlias', () => {
  it('maps loop "1" to continuous true', () => {
    expect(withLoopAlias({ op: 'play-now', contentId: 'plex:1', loop: '1' }).continuous).toBe(true);
  });
  it('maps loop "0" / false to continuous false', () => {
    expect(withLoopAlias({ loop: '0' }).continuous).toBe(false);
    expect(withLoopAlias({ loop: false }).continuous).toBe(false);
  });
  it('keeps an explicit continuous and leaves loop-less payloads untouched', () => {
    expect(withLoopAlias({ loop: '1', continuous: false }).continuous).toBe(false);
    const p = { op: 'play-now' };
    expect(withLoopAlias(p)).toBe(p);
  });
});
