/**
 * Fitness Sync Live Integration Test
 *
 * Run with: npm test -- tests/live/fitness/fitness.live.test.mjs
 *
 * Requires:
 * - Fitness data sources configured (Garmin, Strava, etc.)
 */

import { configService } from '@backend/_legacy/lib/config/index.mjs';
import fitnessSync from '@backend/_legacy/lib/fitsync.mjs';

describe('Fitness Sync Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.TZ = process.env.TZ || 'America/Los_Angeles';
  });

  it('syncs fitness data', async () => {
    const username = configService.getHeadOfHousehold();

    try {
      const result = await fitnessSync(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        if (dates.length > 0) {
          console.log(`Synced fitness data for ${dates.length} dates`);
        } else {
          console.log('Fitness sync completed');
        }
      }
    } catch (error) {
      if (error.message?.includes('credentials') || error.message?.includes('auth')) {
        console.log(`Auth error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 180000);
});
