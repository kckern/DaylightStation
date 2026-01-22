/**
 * Withings - Legacy Re-export Shim
 *
 * MIGRATION: This file wraps WithingsHarvester from the adapter layer.
 * Import from #backend/src/2_adapters/harvester/fitness/WithingsHarvester.mjs instead.
 *
 * Legacy API:
 *   - default (getWeightData) - async (job_id)
 *   - isWithingsInCooldown - ()
 */

import { WithingsHarvester } from '../../src/2_adapters/harvester/fitness/WithingsHarvester.mjs';
import { YamlLifelogStore } from '../../src/2_adapters/harvester/YamlLifelogStore.mjs';
import { YamlAuthStore } from '../../src/2_adapters/harvester/YamlAuthStore.mjs';
import { configService } from '../../src/0_infrastructure/config/index.mjs';
import { userLoadFile, userSaveFile, userSaveAuth } from './io.mjs';
import axios from './http.mjs';
import processWeight from '../jobs/weight.mjs';
import { createLogger } from './logging/logger.js';

const withingsLogger = createLogger({ source: 'backend', app: 'withings' });

// Lazy singleton harvester instance
let harvesterInstance = null;

/**
 * Get or create the singleton WithingsHarvester instance
 * @returns {WithingsHarvester}
 */
function getHarvester() {
  if (!harvesterInstance) {
    // Create store adapters with IO functions
    const lifelogStore = new YamlLifelogStore({
      io: { userLoadFile, userSaveFile },
      logger: withingsLogger,
    });

    const authStore = new YamlAuthStore({
      io: { userSaveAuth },
      logger: withingsLogger,
    });

    harvesterInstance = new WithingsHarvester({
      httpClient: axios,
      configService,
      authStore,
      lifelogStore,
      logger: withingsLogger,
    });
  }
  return harvesterInstance;
}

/**
 * Check if Withings is in cooldown (circuit breaker open)
 * @returns {boolean|Object} false if OK to proceed, or cooldown info
 */
export const isWithingsInCooldown = () => {
  return harvesterInstance?.isInCooldown?.() ?? false;
};

/**
 * Fetch weight data from Withings API
 *
 * Wraps WithingsHarvester.harvest() and calls processWeight for analytics.
 *
 * @param {string} job_id - Job identifier for logging
 * @returns {Promise<Object>} Harvest result or measurements
 */
export default async function getWeightData(job_id) {
  // Dev mode bypass - match legacy behavior
  if (process.env.dev) {
    return processWeight(job_id);
  }

  const username = configService.getHeadOfHousehold();

  try {
    const result = await getHarvester().harvest(username);

    // Call processWeight for analytics (parity with legacy behavior)
    // This computes interpolation, rolling averages, trendlines, caloric balance
    await processWeight(job_id);

    return result;
  } catch (error) {
    // Still run processWeight with cached data if available (parity with legacy)
    await processWeight(job_id);
    throw error;
  }
}
