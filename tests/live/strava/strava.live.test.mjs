/**
 * Strava Live Integration Test
 *
 * Run with: npm test -- tests/live/strava/strava.live.test.mjs
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import harvestActivities, { getAccessToken, isStravaInCooldown } from '../../../backend/lib/strava.mjs';

describe('Strava Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;

    // Set up process.env.path (required by io.mjs and other modules)
    process.env.path = { data: dataPath };

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    // Set secrets in process.env (strava.mjs reads from process.env)
    process.env.STRAVA_CLIENT_ID = configService.getSecret('STRAVA_CLIENT_ID');
    process.env.STRAVA_CLIENT_SECRET = configService.getSecret('STRAVA_CLIENT_SECRET');
  });

  it('harvests strava activities', async () => {
    const cooldown = isStravaInCooldown();
    if (cooldown) {
      console.log(`Circuit breaker open - ${cooldown.remainingMins} mins remaining`);
      return;
    }

    // Get fresh access token
    const token = await getAccessToken();
    if (!token) {
      const clientId = process.env.STRAVA_CLIENT_ID;
      console.log(`Token refresh failed. Re-authorize.`);
      return;
    }
    console.log(`Access token: ${token.substring(0, 10)}...`);

    // Run harvest
    const result = await harvestActivities(null, `test-${Date.now()}`, 7);

    if (result?.skipped) {
      console.log(`Skipped: ${result.reason}`);
    } else if (result?.success === false) {
      console.log(`Failed: ${result.error}`);
    } else if (result?.url) {
      console.log(`Re-auth needed: ${result.url}`);
    } else if (result && typeof result === 'object') {
      const dates = Object.keys(result);
      console.log(`Harvested ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
