import { describe, it, expect } from 'vitest';
import { Usage } from '#domains/cost/value-objects/Usage.mjs';
import { ValidationError } from '#domains/core/errors/index.mjs';

describe('Usage', () => {
  describe('constructor', () => {
    it('should create a Usage with quantity and unit', () => {
      const usage = new Usage(100, 'kWh');
      expect(usage.quantity).toBe(100);
      expect(usage.unit).toBe('kWh');
    });

    it('should allow zero quantity', () => {
      const usage = new Usage(0, 'gallons');
      expect(usage.quantity).toBe(0);
    });

    it('should allow decimal quantities', () => {
      const usage = new Usage(10.5, 'therms');
      expect(usage.quantity).toBe(10.5);
    });

    it('should throw ValidationError for negative quantity', () => {
      expect(() => new Usage(-5, 'kWh')).toThrow(ValidationError);
      expect(() => new Usage(-5, 'kWh')).toThrow('Quantity cannot be negative');
    });

    it('should include error code for negative quantity', () => {
      try {
        new Usage(-5, 'kWh');
      } catch (error) {
        expect(error.code).toBe('NEGATIVE_QUANTITY');
      }
    });

    it('should throw ValidationError for empty unit', () => {
      expect(() => new Usage(100, '')).toThrow(ValidationError);
      expect(() => new Usage(100, '')).toThrow('Unit is required');
    });

    it('should throw ValidationError for missing unit', () => {
      expect(() => new Usage(100)).toThrow(ValidationError);
      expect(() => new Usage(100, null)).toThrow(ValidationError);
      expect(() => new Usage(100, undefined)).toThrow(ValidationError);
    });

    it('should include error code for missing unit', () => {
      try {
        new Usage(100, '');
      } catch (error) {
        expect(error.code).toBe('MISSING_UNIT');
      }
    });
  });

  describe('immutability', () => {
    it('should be frozen (immutable)', () => {
      const usage = new Usage(100, 'kWh');
      expect(Object.isFrozen(usage)).toBe(true);
    });

    it('should not allow modification of quantity', () => {
      const usage = new Usage(100, 'kWh');
      expect(() => {
        usage.quantity = 200;
      }).toThrow();
    });

    it('should not allow modification of unit', () => {
      const usage = new Usage(100, 'kWh');
      expect(() => {
        usage.unit = 'gallons';
      }).toThrow();
    });
  });

  describe('getters', () => {
    it('should return quantity via getter', () => {
      const usage = new Usage(42.5, 'therms');
      expect(usage.quantity).toBe(42.5);
    });

    it('should return unit via getter', () => {
      const usage = new Usage(42.5, 'therms');
      expect(usage.unit).toBe('therms');
    });
  });

  describe('toJSON', () => {
    it('should return object with quantity and unit', () => {
      const usage = new Usage(100, 'kWh');
      const json = usage.toJSON();
      expect(json).toEqual({ quantity: 100, unit: 'kWh' });
    });
  });

  describe('fromJSON', () => {
    it('should create Usage from JSON object', () => {
      const usage = Usage.fromJSON({ quantity: 99.5, unit: 'gallons' });
      expect(usage.quantity).toBe(99.5);
      expect(usage.unit).toBe('gallons');
    });

    it('should throw ValidationError for missing quantity', () => {
      expect(() => Usage.fromJSON({ unit: 'kWh' })).toThrow(ValidationError);
    });

    it('should throw ValidationError for missing unit', () => {
      expect(() => Usage.fromJSON({ quantity: 100 })).toThrow(ValidationError);
    });

    it('should throw ValidationError for null data', () => {
      expect(() => Usage.fromJSON(null)).toThrow(ValidationError);
    });

    it('should throw ValidationError for undefined data', () => {
      expect(() => Usage.fromJSON(undefined)).toThrow(ValidationError);
    });
  });
});
