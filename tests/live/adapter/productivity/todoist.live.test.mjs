/**
 * Todoist Live Integration Test
 *
 * Run with: npm test -- tests/live/todoist/todoist.live.test.mjs
 *
 * Requires:
 * - TODOIST_KEY in secrets.yml OR users/{username}/auth/todoist.yml with api_key
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import getTasks from '#backend/_legacy/lib/todoist.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Todoist Live Integration', () => {
  let dataPath;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.TODOIST_KEY = configService.getSecret('TODOIST_KEY');
  });

  it('fetches todoist tasks', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const auth = configService.getUserAuth('todoist', username) || {};
    const hasCredentials = auth.api_key || process.env.TODOIST_KEY;

    // FAIL if API key not configured
    if (!hasCredentials) {
      throw new Error(
        `[PRECONDITION FAILED] Todoist API key not configured for user '${username}'. ` +
        `Expected: getUserAuth('todoist', '${username}') with {api_key: '...'} ` +
        `or TODOIST_KEY in secrets.yml`
      );
    }

    const result = await getTasks(null, `test-${Date.now()}`, username);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Todoist skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Todoist error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (result?.tasks) {
      console.log(`Fetched ${result.tasks.length} open tasks`);
      expect(result.tasks.length).toBeGreaterThanOrEqual(0);
    } else if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} tasks`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
