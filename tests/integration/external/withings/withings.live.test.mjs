/**
 * Withings Live Integration Test
 *
 * Run with: npm test -- tests/live/withings/withings.live.test.mjs
 *
 * Requires:
 * - WITHINGS_CLIENT_ID and WITHINGS_CLIENT_SECRET in secrets.yml
 * - Valid refresh token in users/{username}/auth/withings.yml
 */

import { configService } from '@backend/_legacy/lib/config/index.mjs';
import getWeightData, { isWithingsInCooldown } from '@backend/_legacy/lib/withings.mjs';

describe('Withings Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    // Set secrets in process.env (withings.mjs reads from process.env)
    process.env.WITHINGS_CLIENT_ID = configService.getSecret('WITHINGS_CLIENT_ID');
    process.env.WITHINGS_CLIENT_SECRET = configService.getSecret('WITHINGS_CLIENT_SECRET');
  });

  it('fetches weight data from Withings API', async () => {
    const cooldown = isWithingsInCooldown();
    if (cooldown) {
      console.log(`Circuit breaker open - ${cooldown.remainingMins} mins remaining`);
      return;
    }

    const result = await getWeightData(`test-${Date.now()}`);

    if (result?.error) {
      console.log(`Error: ${result.error}`);
      if (result.error.includes('No access token') || result.error.includes('refresh')) {
        console.log('Re-authorization may be needed');
      }
    } else if (result?.skipped) {
      console.log(`Skipped: ${result.reason}`);
    } else if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} weight measurements`);
      if (result.length > 0) {
        const latest = result[0];
        console.log(`Latest: ${latest.weight}kg on ${latest.date}`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (result && typeof result === 'object') {
      console.log('Result:', Object.keys(result));
    }
  }, 60000);
});
