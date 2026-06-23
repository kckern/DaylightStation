// abLoop.test.js
import { describe, it, expect } from 'vitest';
import { resolveLoopSeek } from './abLoop.js';

describe('resolveLoopSeek', () => {
  it('loops back to A once the playhead reaches/passes B', () => {
    expect(resolveLoopSeek(10, 4, 10)).toBe(4);
    expect(resolveLoopSeek(11, 4, 10)).toBe(4);
  });
  it('is a no-op before B', () => {
    expect(resolveLoopSeek(7, 4, 10)).toBeNull();
  });
  it('is a no-op when a/b are unset or invalid', () => {
    expect(resolveLoopSeek(10, null, 10)).toBeNull();
    expect(resolveLoopSeek(10, 4, null)).toBeNull();
    expect(resolveLoopSeek(10, 10, 4)).toBeNull();
  });
});
