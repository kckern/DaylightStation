import { describe, it, expect } from 'vitest';
import { Thresholds } from '../../../../../../src/1_domains/cost/value-objects/Thresholds.mjs';

describe('Thresholds', () => {
  describe('construction', () => {
    it('should create with default values when no config provided', () => {
      const thresholds = new Thresholds();
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });

    it('should create with default values when empty config provided', () => {
      const thresholds = new Thresholds({});
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });

    it('should create with custom warning threshold', () => {
      const thresholds = new Thresholds({ warning: 0.5 });
      expect(thresholds.warning).toBe(0.5);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });

    it('should create with custom critical threshold', () => {
      const thresholds = new Thresholds({ critical: 0.9 });
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(0.9);
    });

    it('should create with pace disabled', () => {
      const thresholds = new Thresholds({ pace: false });
      expect(thresholds.pace).toBe(false);
    });

    it('should create with all custom values', () => {
      const thresholds = new Thresholds({
        warning: 0.6,
        critical: 0.85,
        pace: false
      });
      expect(thresholds.warning).toBe(0.6);
      expect(thresholds.critical).toBe(0.85);
      expect(thresholds.pace).toBe(false);
    });

    it('should allow warning greater than critical (no validation)', () => {
      // The value object doesn't enforce warning < critical
      const thresholds = new Thresholds({ warning: 1.0, critical: 0.5 });
      expect(thresholds.warning).toBe(1.0);
      expect(thresholds.critical).toBe(0.5);
    });

    it('should allow zero thresholds', () => {
      const thresholds = new Thresholds({ warning: 0, critical: 0 });
      expect(thresholds.warning).toBe(0);
      expect(thresholds.critical).toBe(0);
    });

    it('should allow thresholds greater than 1', () => {
      // Thresholds can exceed 100% for over-budget alerts
      const thresholds = new Thresholds({ warning: 1.2, critical: 1.5 });
      expect(thresholds.warning).toBe(1.2);
      expect(thresholds.critical).toBe(1.5);
    });
  });

  describe('immutability', () => {
    it('should be frozen', () => {
      const thresholds = new Thresholds();
      expect(Object.isFrozen(thresholds)).toBe(true);
    });

    it('should not allow property assignment', () => {
      const thresholds = new Thresholds();
      expect(() => {
        thresholds.warning = 0.5;
      }).toThrow();
    });
  });

  describe('getters', () => {
    it('should return warning threshold', () => {
      const thresholds = new Thresholds({ warning: 0.75 });
      expect(thresholds.warning).toBe(0.75);
    });

    it('should return critical threshold', () => {
      const thresholds = new Thresholds({ critical: 0.95 });
      expect(thresholds.critical).toBe(0.95);
    });

    it('should return pace flag', () => {
      const thresholds = new Thresholds({ pace: false });
      expect(thresholds.pace).toBe(false);
    });
  });

  describe('serialization', () => {
    describe('toJSON', () => {
      it('should serialize all fields', () => {
        const thresholds = new Thresholds({
          warning: 0.7,
          critical: 0.9,
          pace: true
        });
        expect(thresholds.toJSON()).toEqual({
          warning: 0.7,
          critical: 0.9,
          pace: true
        });
      });

      it('should serialize default values', () => {
        const thresholds = new Thresholds();
        expect(thresholds.toJSON()).toEqual({
          warning: 0.8,
          critical: 1.0,
          pace: true
        });
      });
    });

    describe('fromJSON', () => {
      it('should create from valid JSON object', () => {
        const thresholds = Thresholds.fromJSON({
          warning: 0.6,
          critical: 0.85,
          pace: false
        });
        expect(thresholds.warning).toBe(0.6);
        expect(thresholds.critical).toBe(0.85);
        expect(thresholds.pace).toBe(false);
      });

      it('should use defaults for missing fields', () => {
        const thresholds = Thresholds.fromJSON({ warning: 0.5 });
        expect(thresholds.warning).toBe(0.5);
        expect(thresholds.critical).toBe(1.0);
        expect(thresholds.pace).toBe(true);
      });

      it('should return defaults for null input', () => {
        const thresholds = Thresholds.fromJSON(null);
        expect(thresholds.warning).toBe(0.8);
        expect(thresholds.critical).toBe(1.0);
        expect(thresholds.pace).toBe(true);
      });

      it('should return defaults for undefined input', () => {
        const thresholds = Thresholds.fromJSON(undefined);
        expect(thresholds.warning).toBe(0.8);
        expect(thresholds.critical).toBe(1.0);
        expect(thresholds.pace).toBe(true);
      });

      it('should return defaults for non-object input', () => {
        const thresholds = Thresholds.fromJSON('invalid');
        expect(thresholds.warning).toBe(0.8);
        expect(thresholds.critical).toBe(1.0);
      });

      it('should return defaults for empty object', () => {
        const thresholds = Thresholds.fromJSON({});
        expect(thresholds.warning).toBe(0.8);
        expect(thresholds.critical).toBe(1.0);
        expect(thresholds.pace).toBe(true);
      });
    });

    it('should round-trip toJSON and fromJSON', () => {
      const original = new Thresholds({
        warning: 0.65,
        critical: 0.92,
        pace: false
      });
      const json = original.toJSON();
      const restored = Thresholds.fromJSON(json);

      expect(restored.warning).toBe(original.warning);
      expect(restored.critical).toBe(original.critical);
      expect(restored.pace).toBe(original.pace);
    });
  });

  describe('static defaults', () => {
    it('should return Thresholds with default values', () => {
      const thresholds = Thresholds.defaults();
      expect(thresholds).toBeInstanceOf(Thresholds);
      expect(thresholds.warning).toBe(0.8);
      expect(thresholds.critical).toBe(1.0);
      expect(thresholds.pace).toBe(true);
    });
  });
});
