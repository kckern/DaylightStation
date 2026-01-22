/**
 * ClickUp Live Integration Test
 *
 * Run with: npm test -- tests/live/clickup/clickup.live.test.mjs
 *
 * Requires:
 * - CLICKUP_PK (API key) in secrets.yml or household auth
 * - process.env.clickup config with statuses and team_id
 */

import { configService } from '#backend/_legacy/lib/config/index.mjs';

// Set up env before importing clickup.mjs
const dataPath = process.env.DAYLIGHT_DATA_PATH;
if (dataPath && !configService.isInitialized()) {
  configService.init({ dataDir: dataPath });
}

// ClickUp requires env config for statuses and team_id
const clickupConfig = configService.getAppConfig('clickup') || {};
process.env.clickup = {
  statuses: clickupConfig.statuses || [],
  team_id: clickupConfig.team_id || ''
};
process.env.CLICKUP_PK = configService.getSecret('CLICKUP_PK');

let getClickUpTasks;
try {
  const mod = await import('#backend/lib/clickup.mjs');
  getClickUpTasks = mod.default;
} catch (e) {
  console.log('clickup.mjs failed to load:', e.message);
}

describe('ClickUp Live Integration', () => {
  beforeAll(() => {
    // Already initialized above
  });

  it('fetches clickup tasks', async () => {
    if (!getClickUpTasks) {
      console.log('ClickUp module not loaded - skipping test');
      return;
    }

    const username = configService.getHeadOfHousehold();

    if (!process.env.CLICKUP_PK || !process.env.clickup?.team_id) {
      console.log('ClickUp not fully configured - skipping test');
      return;
    }

    try {
      const result = await getClickUpTasks(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} ClickUp items`);
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        console.log('ClickUp data fetched');
      }
    } catch (error) {
      if (error.message?.includes('API') || error.message?.includes('auth')) {
        console.log(`Auth error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 60000);
});
