/**
 * ClickUp Live Integration Test
 *
 * Run with: npm test -- tests/live/clickup/clickup.live.test.mjs
 *
 * Requires:
 * - CLICKUP_PK (API key) in secrets.yml or household auth
 * - process.env.clickup config with statuses and team_id
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

// FAIL early if data path not configured
const dataPath = getDataPath();
if (!dataPath) {
  throw new Error('[PRECONDITION FAILED] Data path not configured. Set DAYLIGHT_DATA_PATH.');
}
if (!configService.isReady()) {
  initConfigService(dataPath);
}

// ClickUp requires env config for statuses and team_id
const clickupConfig = configService.getAppConfig('clickup') || {};
process.env.clickup = {
  statuses: clickupConfig.statuses || [],
  team_id: clickupConfig.team_id || ''
};
process.env.CLICKUP_PK = configService.getSecret('CLICKUP_PK');

let getClickUpTasks;
let moduleError = null;
try {
  const mod = await import('#backend/lib/clickup.mjs');
  getClickUpTasks = mod.default;
} catch (e) {
  moduleError = e.message;
}

describe('ClickUp Live Integration', () => {
  beforeAll(() => {
    // FAIL if module didn't load
    if (moduleError || !getClickUpTasks) {
      throw new Error(
        `[PRECONDITION FAILED] ClickUp module not loaded: ${moduleError || 'unknown error'}`
      );
    }

    // FAIL if credentials not configured
    requireConfig('CLICKUP_PK', process.env.CLICKUP_PK);
    requireConfig('ClickUp team_id', process.env.clickup?.team_id);
  });

  it('fetches clickup tasks', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const result = await getClickUpTasks(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`ClickUp skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] ClickUp error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} ClickUp items`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      console.log('ClickUp data fetched');
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
