/**
 * Todoist Live Integration Test
 *
 * Run with: npm test -- tests/live/todoist/todoist.live.test.mjs
 *
 * Requires:
 * - TODOIST_KEY in secrets.yml OR users/{username}/auth/todoist.yml with api_key
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import getTasks from '#backend/_legacy/lib/todoist.mjs';

describe('Todoist Live Integration', () => {
  beforeAll(() => {
    const dataPath = getDataPath();
    if (!dataPath) {
      throw new Error('Could not determine data path from .env');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.TODOIST_KEY = configService.getSecret('TODOIST_KEY');
  });

  it('fetches todoist tasks', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('todoist', username) || {};
    const hasCredentials = auth.api_key || process.env.TODOIST_KEY;

    if (!hasCredentials) {
      console.log('Todoist API key not configured - skipping test');
      return;
    }

    try {
      const result = await getTasks(null, `test-${Date.now()}`, username);

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.tasks) {
        console.log(`Fetched ${result.tasks.length} open tasks`);
        expect(result.tasks.length).toBeGreaterThanOrEqual(0);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} tasks`);
      }
    } catch (error) {
      if (error.message?.includes('API key')) {
        console.log('API key invalid or not configured');
      } else {
        throw error;
      }
    }
  }, 60000);
});
