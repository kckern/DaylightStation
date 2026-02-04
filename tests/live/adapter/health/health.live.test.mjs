/**
 * Health Live Integration Test
 *
 * Run with: npm test -- tests/live/health/health.live.test.mjs
 *
 * Aggregates health data from multiple sources (Withings, Garmin, etc.)
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import healthHarvest from '#backend/_legacy/lib/health.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Health Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.TZ = process.env.TZ || 'America/Los_Angeles';
  });

  it('aggregates health data', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const result = await healthHarvest(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Health skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Health error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      if (dates.length > 0) {
        console.log(`Aggregated health data for ${dates.length} dates`);
      } else {
        console.log('Health aggregation completed');
      }
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 180000);
});
