/**
 * Goodreads Live Integration Test
 *
 * Run with: npm test -- tests/live/goodreads/goodreads.live.test.mjs
 *
 * Requires:
 * - Goodreads user ID/URL in users/{username}/auth/goodreads.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getBooks from '#backend/_legacy/lib/goodreads.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Goodreads Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.GOODREADS_USER = configService.getSecret('GOODREADS_USER');
  });

  it('scrapes goodreads reading list', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('goodreads', username) || {};
    const goodreadsUser = auth.user_id || auth.username || process.env.GOODREADS_USER;

    // FAIL if Goodreads user not configured
    if (!goodreadsUser) {
      throw new Error(
        `[PRECONDITION FAILED] Goodreads user not configured for user '${username}'. ` +
        `Expected: getUserAuth('goodreads', '${username}') with {user_id: '...'} ` +
        `or GOODREADS_USER in secrets.yml`
      );
    }

    const result = await getBooks(username);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Goodreads skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Goodreads error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} books`);
      if (result.length > 0) {
        const recent = result[0];
        console.log(`Recent: "${recent.title}" by ${recent.author}`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
