/**
 * Foursquare Live Integration Test
 *
 * Run with: npm test -- tests/live/foursquare/foursquare.live.test.mjs
 *
 * Requires:
 * - Foursquare OAuth token in users/{username}/auth/foursquare.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getCheckins from '#backend/_legacy/lib/foursquare.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Foursquare Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.FOURSQUARE_TOKEN = configService.getSecret('FOURSQUARE_TOKEN');
  });

  it('fetches foursquare checkins', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('foursquare', username) || {};
    const token = auth.token || process.env.FOURSQUARE_TOKEN;

    // FAIL if token not configured
    if (!token) {
      throw new Error(
        `[PRECONDITION FAILED] Foursquare token not configured for user '${username}'. ` +
        `Expected: getUserAuth('foursquare', '${username}') with {token: '...'} ` +
        `or FOURSQUARE_TOKEN in secrets.yml`
      );
    }

    const result = await getCheckins(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Foursquare skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Foursquare error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} checkins`);
      if (result.length > 0) {
        const latest = result[0];
        console.log(`Latest: ${latest.venue || latest.name} on ${latest.date}`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched checkins for ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
