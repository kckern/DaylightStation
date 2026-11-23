import { describe, it, expect } from 'vitest';
import { blurPlaysAs, maxHideSec } from './blurPlaysAs.mjs';

describe('blurPlaysAs', () => {
  it('tracked stays a blur', () => expect(blurPlaysAs({ tracked: true, spanSec: 60 }, 20)).toBe('blur'));
  it('untracked and short is the whole picture', () => expect(blurPlaysAs({ tracked: false, spanSec: 10 }, 20)).toBe('full-blur'));
  it('untracked and past the limit is hidden', () => expect(blurPlaysAs({ tracked: false, spanSec: 38.5 }, 20)).toBe('blackout'));
  it('no limit never hides', () => expect(blurPlaysAs({ tracked: false, spanSec: 38.5 }, null)).toBe('full-blur'));
});
describe('maxHideSec', () => {
  it('reads the full-blur maxSec, null when off, default when unset', () => {
    expect(maxHideSec({ 'full-blur': { maxSec: 20 } })).toBe(20);
    expect(maxHideSec({ 'full-blur': { maxSec: 0 } })).toBeNull();
    expect(maxHideSec({})).toBe(5);
  });
});
