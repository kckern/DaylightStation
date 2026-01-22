/**
 * Legacy entropy.mjs - Re-export shim
 *
 * This file has been migrated to the DDD structure.
 * All functionality now lives in:
 *   - backend/src/1_domains/entropy/services/EntropyService.mjs
 *   - backend/src/2_adapters/entropy/YamlEntropyReader.mjs
 *
 * This shim provides backward compatibility for existing imports.
 *
 * @deprecated Use EntropyService from '#backend/src/1_domains/entropy' instead
 */

import { createWithLegacyDependencies } from '../../src/1_domains/entropy/services/EntropyService.mjs';

// Lazy initialization of the singleton
let _instance = null;
let _initPromise = null;

/**
 * Get or create the lazy-initialized entropy service instance
 * @returns {Promise<{ entropyService: Object, getEntropyReport: Function }>}
 */
async function getInstance() {
  if (_instance) return _instance;
  if (_initPromise) return _initPromise;

  _initPromise = createWithLegacyDependencies();
  _instance = await _initPromise;
  return _instance;
}

/**
 * Get entropy report for all configured sources
 * @returns {Promise<Object>} Entropy report
 * @deprecated Use EntropyService.getReport() instead
 */
export const getEntropyReport = async () => {
  const { getEntropyReport: report } = await getInstance();
  return report();
};

// Re-export the service and factory for direct access
export { createWithLegacyDependencies };
export { EntropyService } from '../../src/1_domains/entropy/services/EntropyService.mjs';
