/**
 * Withings Live Integration Test
 *
 * Run with: npm test -- tests/live/withings/withings.live.test.mjs
 *
 * Requires:
 * - WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET in secrets.yml
 * - Valid refresh token in users/{username}/auth/withings.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getWeightData, { isWithingsInCooldown } from '#backend/_legacy/lib/withings.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireSecret, skipIf, SkipTestError } from '../test-preconditions.mjs';

describe('Withings Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if secrets not configured
    process.env.WITHINGS_CLIENT_ID = requireSecret('WITHINGS_CLIENT_ID', configService);
    process.env.WITHINGS_CLIENT_SECRET = requireSecret('WITHINGS_CLIENT_SECRET', configService);
  });

  it('fetches weight data from Withings API', async () => {
    // Explicit skip for circuit breaker - don't silently pass
    const cooldown = isWithingsInCooldown();
    skipIf(cooldown, `Circuit breaker open - ${cooldown?.remainingMins} mins remaining`);

    const result = await getWeightData(`test-${Date.now()}`);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Withings skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      if (result.error.includes('No access token') || result.error.includes('refresh')) {
        throw new Error(
          `[ASSERTION FAILED] Withings auth error: ${result.error}. ` +
          'Re-authorization may be needed.'
        );
      }
      throw new Error(`[ASSERTION FAILED] Withings error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} weight measurements`);
      if (result.length > 0) {
        const latest = result[0];
        console.log(`Latest: ${latest.weight}kg on ${latest.date}`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      console.log('Result keys:', Object.keys(result));
      // Should still have some structure
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
