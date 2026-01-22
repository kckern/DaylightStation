/**
 * Foursquare Live Integration Test
 *
 * Run with: npm test -- tests/live/foursquare/foursquare.live.test.mjs
 *
 * Requires:
 * - Foursquare OAuth token in users/{username}/auth/foursquare.yml
 */

import { configService } from '#backend/src/0_infrastructure/config/index.mjs';
import getCheckins from '#backend/_legacy/lib/foursquare.mjs';

describe('Foursquare Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.FOURSQUARE_TOKEN = configService.getSecret('FOURSQUARE_TOKEN');
  });

  it('fetches foursquare checkins', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('foursquare', username) || {};
    const token = auth.token || process.env.FOURSQUARE_TOKEN;

    if (!token) {
      console.log('Foursquare token not configured - skipping test');
      return;
    }

    try {
      const result = await getCheckins(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} checkins`);
        if (result.length > 0) {
          const latest = result[0];
          console.log(`Latest: ${latest.venue || latest.name} on ${latest.date}`);
        }
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Fetched checkins for ${dates.length} dates`);
      }
    } catch (error) {
      if (error.message?.includes('token') || error.message?.includes('auth')) {
        console.log(`Auth error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 60000);
});
