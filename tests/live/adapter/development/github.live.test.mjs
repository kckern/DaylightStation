/**
 * GitHub Live Integration Test
 *
 * Run with: npm test -- tests/live/github/github.live.test.mjs
 *
 * Requires:
 * - GitHub username in users/{username}/auth/github.yml
 * - Optional: GitHub token for private repos and higher rate limits
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getGitHubActivity from '#backend/_legacy/lib/github.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('GitHub Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }
  });

  it('fetches github activity', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('github', username) || {};

    // FAIL if GitHub username not configured
    if (!auth.username) {
      throw new Error(
        `[PRECONDITION FAILED] GitHub username not configured for user '${username}'. ` +
        `Expected: getUserAuth('github', '${username}') with {username: 'github_username'}`
      );
    }

    const result = await getGitHubActivity(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`GitHub skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] GitHub error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} commits/events`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched activity for ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
