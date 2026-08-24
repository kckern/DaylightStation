import { describe, expect, it } from 'vitest';
import { geometryFor, percentileFaces } from './diceGeometry.js';

describe('polyhedral dice presentation', () => {
  it('uses percentile tens and ones without changing the committed d100 result', () => {
    expect(percentileFaces(1)).toEqual([0, 1]); expect(percentileFaces(10)).toEqual([10, 0]); expect(percentileFaces(100)).toEqual([0, 0]);
  });
  it('constructs standard supported geometries including a non-cylindrical d10', () => {
    const geometry = geometryFor(10); expect(geometry.type).toBe('PolyhedronGeometry'); geometry.dispose();
  });
});
