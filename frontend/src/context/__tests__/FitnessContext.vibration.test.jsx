import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateIntensity } from '../FitnessContext.jsx';

describe('FitnessContext vibration utilities', () => {
  describe('calculateIntensity', () => {
    it('calculates magnitude correctly', () => {
      assert.equal(calculateIntensity(3, 4, 0), 5);
    });

    it('returns 0 when any axis is null', () => {
      assert.equal(calculateIntensity(null, 5, 5), 0);
      assert.equal(calculateIntensity(5, null, 5), 0);
      assert.equal(calculateIntensity(5, 5, null), 0);
    });

    it('handles negative values', () => {
      assert.equal(calculateIntensity(-3, -4, 0), 5);
    });
  });
});
