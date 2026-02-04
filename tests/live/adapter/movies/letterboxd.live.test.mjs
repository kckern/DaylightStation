/**
 * Letterboxd Live Integration Test
 *
 * Run with: npm test -- tests/live/letterboxd/letterboxd.live.test.mjs
 *
 * Requires:
 * - Letterboxd username in users/{username}/auth/letterboxd.yml
 *   OR LETTERBOXD_USER in secrets.yml/environment
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getMovies from '#backend/_legacy/lib/letterboxd.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Letterboxd Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Set fallback env var
    process.env.LETTERBOXD_USER = configService.getSecret('LETTERBOXD_USER');
  });

  it('scrapes letterboxd diary entries', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('letterboxd', username) || {};
    const letterboxdUser = auth.username || process.env.LETTERBOXD_USER;

    // FAIL if Letterboxd username not configured
    if (!letterboxdUser) {
      throw new Error(
        `[PRECONDITION FAILED] Letterboxd username not configured for user '${username}'. ` +
        `Expected: getUserAuth('letterboxd', '${username}') with {username: 'letterboxd_username'} ` +
        `or LETTERBOXD_USER in secrets.yml`
      );
    }

    console.log(`Fetching diary for Letterboxd user: ${letterboxdUser}`);
    const result = await getMovies(username);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Letterboxd skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Letterboxd error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();
    expect(Array.isArray(result)).toBe(true);

    console.log(`Fetched ${result.length} diary entries`);
    if (result.length > 0) {
      const latest = result[0];
      console.log(`Latest: "${latest.title}" on ${latest.date} (rating: ${latest.rating || 'unrated'})`);
    }
    expect(result.length).toBeGreaterThanOrEqual(0);
  }, 60000);
});
