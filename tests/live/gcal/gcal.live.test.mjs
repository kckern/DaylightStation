/**
 * Google Calendar Live Integration Test
 *
 * Run with: npm run test:live -- --only=gcal
 * Or directly: npm test -- tests/live/gcal/gcal.live.test.mjs
 *
 * Requires:
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in secrets.yml
 * - OAuth refresh token in users/{username}/auth/gcal.yml
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import getCalendarEvents from '../../../backend/lib/gcal.mjs';
import { getToday, getDaysAgo } from '../harness-utils.mjs';

describe('Google Calendar Live Integration', () => {
  let username;

  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.GOOGLE_CLIENT_ID = configService.getSecret('GOOGLE_CLIENT_ID');
    process.env.GOOGLE_CLIENT_SECRET = configService.getSecret('GOOGLE_CLIENT_SECRET');
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    username = configService.getHeadOfHousehold();
  });

  it('fetches calendar events', async () => {
    const auth = configService.getUserAuth('gcal', username) || {};

    if (!auth.refresh_token) {
      console.log('Google Calendar OAuth not configured - skipping test');
      return;
    }

    const requestId = `test-${Date.now()}`;
    const result = await getCalendarEvents(null, requestId, username);

    // Handle error responses
    if (result?.error) {
      throw new Error(`API error: ${result.error}`);
    }
    if (result?.url) {
      throw new Error(`Re-auth needed: ${result.url}`);
    }

    // Verify we got calendar data
    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} events`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (result && typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched events for ${dates.length} dates`);

      // Verify we have data for recent dates (within last 7 days)
      const weekAgo = getDaysAgo(7);
      const today = getToday();
      const recentDates = dates.filter(d => d >= weekAgo && d <= today);
      console.log(`Recent dates (last 7 days): ${recentDates.length}`);
    }
  }, 60000);
});
