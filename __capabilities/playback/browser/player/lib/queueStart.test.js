import { describe, expect, it } from 'vitest';
import { queueStartIndex } from './queueStart.js';

describe('queueStartIndex', () => {
  it('is the answer startIndex when it is inside the queue', () => {
    expect(queueStartIndex({ startIndex: 2 }, 5)).toBe(2);
  });
  it('is 0 for a show or music answer (no startIndex), or one out of range', () => {
    expect(queueStartIndex({}, 5)).toBe(0);
    expect(queueStartIndex(null, 5)).toBe(0);
    expect(queueStartIndex({ startIndex: 5 }, 5)).toBe(0);
    expect(queueStartIndex({ startIndex: -1 }, 5)).toBe(0);
    expect(queueStartIndex({ startIndex: '2' }, 5)).toBe(0);
  });
});
