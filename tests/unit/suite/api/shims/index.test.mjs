// tests/unit/api/shims/index.test.mjs
import { allShims, getShim, applyShim } from '@backend/src/4_api/shims/index.mjs';

describe('Shim Registry', () => {
  describe('allShims', () => {
    it('exports all finance shims', () => {
      expect(allShims['finance-data-v1']).toBeDefined();
      expect(allShims['finance-daytoday-v1']).toBeDefined();
    });

    it('exports all content shims', () => {
      expect(allShims['content-list-v1']).toBeDefined();
    });

    it('each shim has required properties', () => {
      for (const [key, shim] of Object.entries(allShims)) {
        expect(shim.name).toBe(key);
        expect(shim.description).toBeDefined();
        expect(typeof shim.transform).toBe('function');
      }
    });
  });

  describe('getShim', () => {
    it('returns shim by name', () => {
      const shim = getShim('finance-data-v1');
      expect(shim).toBeDefined();
      expect(shim.name).toBe('finance-data-v1');
    });

    it('returns undefined for unknown shim', () => {
      const shim = getShim('nonexistent-shim');
      expect(shim).toBeUndefined();
    });
  });

  describe('applyShim', () => {
    it('applies shim transformation', () => {
      const newFormat = {
        budgets: [
          { periodStart: '2025-01-01', periodEnd: '2025-12-31', allocated: 5000 }
        ],
        mortgage: null
      };

      const legacy = applyShim('finance-data-v1', newFormat);

      expect(legacy.budgets['2025-01-01']).toBeDefined();
      expect(legacy.budgets['2025-01-01'].allocated).toBe(5000);
    });

    it('throws for unknown shim', () => {
      expect(() => applyShim('nonexistent-shim', {})).toThrow('Shim not found: nonexistent-shim');
    });
  });
});
