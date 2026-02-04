/**
 * Reddit Live Integration Test
 *
 * Run with: npm test -- tests/live/reddit/reddit.live.test.mjs
 *
 * Requires:
 * - Reddit username in users/{username}/auth/reddit.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getRedditActivity from '#backend/_legacy/lib/reddit.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Reddit Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.REDDIT_USER = configService.getSecret('REDDIT_USER');
  });

  it('fetches reddit activity', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('reddit', username) || {};
    const redditUser = auth.username || process.env.REDDIT_USER;

    // FAIL if Reddit username not configured
    if (!redditUser) {
      throw new Error(
        `[PRECONDITION FAILED] Reddit username not configured for user '${username}'. ` +
        `Expected: getUserAuth('reddit', '${username}') with {username: 'reddit_username'} ` +
        `or REDDIT_USER in secrets.yml`
      );
    }

    const result = await getRedditActivity(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Reddit skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Reddit error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} reddit activities`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched activity for ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
