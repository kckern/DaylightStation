// tests/unit/domains/fitness/ports/IFitnessSyncerGateway.test.mjs
import { describe, it, expect } from '@jest/globals';
import {
  IFitnessSyncerGateway,
  isFitnessSyncerGateway,
  assertFitnessSyncerGateway
} from '@backend/src/1_domains/fitness/ports/IFitnessSyncerGateway.mjs';

describe('IFitnessSyncerGateway', () => {
  describe('requiredMethods', () => {
    it('should define all required methods', () => {
      expect(IFitnessSyncerGateway.requiredMethods).toEqual([
        'getAccessToken',
        'getActivities',
        'getSourceId',
        'setSourceId',
        'isInCooldown'
      ]);
    });
  });

  describe('validate', () => {
    it('should return true for valid implementations', () => {
      const validImpl = {
        getAccessToken: () => {},
        getActivities: () => {},
        getSourceId: () => {},
        setSourceId: () => {},
        isInCooldown: () => {}
      };
      expect(IFitnessSyncerGateway.validate(validImpl)).toBe(true);
    });

    it('should throw for missing methods', () => {
      const invalidImpl = { getAccessToken: () => {} };
      expect(() => IFitnessSyncerGateway.validate(invalidImpl)).toThrow(
        "IFitnessSyncerGateway: missing required method 'getActivities'"
      );
    });

    it('should throw for non-function properties', () => {
      const invalidImpl = {
        getAccessToken: () => {},
        getActivities: 'not a function',
        getSourceId: () => {},
        setSourceId: () => {},
        isInCooldown: () => {}
      };
      expect(() => IFitnessSyncerGateway.validate(invalidImpl)).toThrow(
        "IFitnessSyncerGateway: missing required method 'getActivities'"
      );
    });
  });

  describe('isFitnessSyncerGateway', () => {
    it('should return true for valid implementation', () => {
      const validImpl = {
        getAccessToken: () => {},
        getActivities: () => {},
        getSourceId: () => {},
        setSourceId: () => {},
        isInCooldown: () => {}
      };
      expect(isFitnessSyncerGateway(validImpl)).toBe(true);
    });

    it('should return false for incomplete implementation', () => {
      const incomplete = {
        getAccessToken: () => {},
        getActivities: () => {}
        // missing other methods
      };
      expect(isFitnessSyncerGateway(incomplete)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isFitnessSyncerGateway(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(isFitnessSyncerGateway('string')).toBe(false);
    });
  });

  describe('assertFitnessSyncerGateway', () => {
    it('should return gateway if valid', () => {
      const validImpl = {
        getAccessToken: () => {},
        getActivities: () => {},
        getSourceId: () => {},
        setSourceId: () => {},
        isInCooldown: () => {}
      };
      expect(assertFitnessSyncerGateway(validImpl)).toBe(validImpl);
    });

    it('should throw for invalid implementation', () => {
      const incomplete = { getAccessToken: () => {} };
      expect(() => assertFitnessSyncerGateway(incomplete)).toThrow(
        'does not implement IFitnessSyncerGateway'
      );
    });
  });
});
