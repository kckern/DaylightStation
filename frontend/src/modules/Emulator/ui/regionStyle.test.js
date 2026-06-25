import { describe, it, expect } from 'vitest';
import { regionStyle } from './regionStyle.js';

describe('regionStyle', () => {
  it('maps a %-region to absolute CSS percentage offsets', () => {
    expect(regionStyle({ x: 29.04, y: 10.88, width: 41.667, height: 66.667 })).toEqual({
      position: 'absolute',
      left: '29.04%',
      top: '10.88%',
      width: '41.667%',
      height: '66.667%',
    });
  });

  it('returns an empty object for a missing region', () => {
    expect(regionStyle(null)).toEqual({});
    expect(regionStyle(undefined)).toEqual({});
  });

  it('omits edges whose values are not finite numbers', () => {
    expect(regionStyle({ x: 10, width: 5 })).toEqual({
      position: 'absolute',
      left: '10%',
      width: '5%',
    });
  });
});
