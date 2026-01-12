// tests/unit/api/middleware/legacyPlayShim.test.mjs
import { createLegacyPlayShim } from '../../../../backend/src/4_api/middleware/legacyPlayShim.mjs';

describe('Legacy Play Shim', () => {
  describe('createLegacyPlayShim', () => {
    it('creates an express router', () => {
      const router = createLegacyPlayShim();
      expect(router).toBeDefined();
      expect(typeof router).toBe('function');
    });

    it('has route handlers for legacy endpoints', () => {
      const router = createLegacyPlayShim();
      // Router should have stack with handlers
      expect(router.stack).toBeDefined();
      expect(router.stack.length).toBeGreaterThan(0);
    });
  });
});
