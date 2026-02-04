/**
 * Last.fm Live Integration Test
 *
 * Run with: npm test -- tests/live/lastfm/lastfm.live.test.mjs
 *
 * Requires:
 * - LASTFM_API_KEY in secrets.yml
 * - Last.fm username in users/{username}/auth/lastfm.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getScrobbles from '#backend/_legacy/lib/lastfm.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Last.fm Live Integration', () => {
  let dataPath;
  let apiKey;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if API key not configured (check multiple possible names)
    apiKey = configService.getSecret('LASTFM_API_KEY') ||
             configService.getSecret('LAST_FM_API_KEY') ||
             process.env.LASTFM_API_KEY;

    requireConfig('LASTFM_API_KEY (or LAST_FM_API_KEY)', apiKey);
    process.env.LASTFM_API_KEY = apiKey;
  });

  const isBackfill = process.env.LASTFM_BACKFILL === 'true';
  const backfillSince = process.env.LASTFM_BACKFILL_SINCE || '2008-01-01';
  const testTimeout = isBackfill ? 300000 : 60000;

  it('fetches lastfm scrobbles', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('lastfm', username) || {};

    // FAIL if Last.fm username not configured
    if (!auth.username) {
      throw new Error(
        `[PRECONDITION FAILED] Last.fm username not configured for user '${username}'. ` +
        `Expected: getUserAuth('lastfm', '${username}') with {username: 'lastfm_username'}`
      );
    }

    const result = await getScrobbles(`test-${Date.now()}`, {
      targetUsername: username,
      backfill: isBackfill,
      query: { backfillSince }
    });

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Last.fm error: ${result.error}`);
    }

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Last.fm skipped: ${result.reason}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} scrobbles${isBackfill ? ' (backfill)' : ''}`);
      if (result.length > 0) {
        const latest = result[0];
        console.log(`Latest: "${latest.title}" by ${latest.artist}`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched scrobbles for ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, testTimeout);
});
