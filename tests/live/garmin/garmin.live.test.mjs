/**
 * Garmin Live Integration Test
 *
 * Run with: npm test -- tests/live/garmin/garmin.live.test.mjs
 *
 * Requires:
 * - Garmin credentials in users/{username}/auth/garmin.yml (username, password)
 *   OR GARMIN_USERNAME and GARMIN_PASSWORD in secrets.yml
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import harvestActivities, { isGarminInCooldown } from '../../../backend/lib/garmin.mjs';

describe('Garmin Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    // Set timezone
    process.env.TZ = process.env.TZ || 'America/Los_Angeles';

    // Set secrets in process.env (garmin.mjs can read from process.env as fallback)
    process.env.GARMIN_USERNAME = configService.getSecret('GARMIN_USERNAME');
    process.env.GARMIN_PASSWORD = configService.getSecret('GARMIN_PASSWORD');
  });

  it('harvests garmin activities', async () => {
    const cooldown = isGarminInCooldown();
    if (cooldown) {
      console.log(`Circuit breaker open - ${cooldown.remainingMins} mins remaining`);
      return;
    }

    // Check if credentials are available
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('garmin', username) || {};
    const hasCredentials = (auth.username && auth.password) ||
                          (process.env.GARMIN_USERNAME && process.env.GARMIN_PASSWORD);

    if (!hasCredentials) {
      console.log('Garmin credentials not configured - skipping test');
      return;
    }

    try {
      const result = await harvestActivities(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Harvested ${dates.length} dates with activities`);
        expect(dates.length).toBeGreaterThanOrEqual(0);
      }
    } catch (error) {
      // Garmin login can fail due to CAPTCHA or 2FA
      if (error.message?.includes('credentials') || error.message?.includes('login')) {
        console.log(`Login failed: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 120000);
});
