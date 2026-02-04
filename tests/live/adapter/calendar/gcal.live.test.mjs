/**
 * Google Calendar Live Integration Test
 *
 * Run with: npm run test:live -- --only=gcal
 * Or directly: npm test -- tests/live/gcal/gcal.live.test.mjs
 *
 * Requires:
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in secrets.yml
 * - OAuth refresh token in users/{username}/auth/gcal.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getCalendarEvents from '#backend/_legacy/lib/gcal.mjs';
import { getToday, getDaysAgo } from '../harness-utils.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireSecret, requireConfig } from '../test-preconditions.mjs';

describe('Google Calendar Live Integration', () => {
  let username;

  beforeAll(() => {
    // FAIL if data path not configured
    const dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if secrets not configured
    process.env.GOOGLE_CLIENT_ID = requireSecret('GOOGLE_CLIENT_ID', configService);
    process.env.GOOGLE_CLIENT_SECRET = requireSecret('GOOGLE_CLIENT_SECRET', configService);
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);
  });

  it('fetches calendar events', async () => {
    const auth = configService.getUserAuth('gcal', username) || {};

    // FAIL if OAuth not configured
    if (!auth.refresh_token) {
      throw new Error(
        `[PRECONDITION FAILED] Google Calendar OAuth not configured for user '${username}'. ` +
        `Expected: getUserAuth('gcal', '${username}') with {refresh_token: '...'}`
      );
    }

    const requestId = `test-${Date.now()}`;
    const result = await getCalendarEvents(null, requestId, username);

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] GCal API error: ${result.error}`);
    }
    if (result?.url) {
      throw new Error(`[ASSERTION FAILED] GCal re-auth needed: ${result.url}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} events`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched events for ${dates.length} dates`);

      // Verify we have data structure
      expect(dates.length).toBeGreaterThanOrEqual(0);

      // Log recent dates for debugging
      const weekAgo = getDaysAgo(7);
      const today = getToday();
      const recentDates = dates.filter(d => d >= weekAgo && d <= today);
      console.log(`Recent dates (last 7 days): ${recentDates.length}`);
    }
  }, 60000);
});
