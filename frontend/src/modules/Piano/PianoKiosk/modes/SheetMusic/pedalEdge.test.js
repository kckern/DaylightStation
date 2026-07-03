import { describe, it, expect } from 'vitest';
import { isRisingEdge } from './pedalEdge.js';

describe('isRisingEdge', () => {
  it('true when crossing up through the threshold', () => {
    expect(isRisingEdge(0, 127)).toBe(true);
    expect(isRisingEdge(10, 64)).toBe(true);
  });
  it('false when already high or going down', () => {
    expect(isRisingEdge(64, 127)).toBe(false);
    expect(isRisingEdge(127, 0)).toBe(false);
    expect(isRisingEdge(0, 10)).toBe(false); // below threshold
  });
  it('custom threshold', () => {
    expect(isRisingEdge(0, 100, 90)).toBe(true);
    expect(isRisingEdge(0, 80, 90)).toBe(false);
  });
});
