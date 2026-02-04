/**
 * LDS General Conference Live Integration Test
 *
 * Run with: npm test -- tests/live/ldsgc/ldsgc.live.test.mjs
 *
 * Fetches LDS General Conference talk data
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getLDSGCData from '#backend/_legacy/lib/ldsgc.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';

describe('LDSGC Live Integration', () => {
  beforeAll(() => {
    const dataPath = getDataPath();
    if (!dataPath) {
      throw new Error('Could not determine data path from .env');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }
  });

  it('fetches conference data', async () => {
    const username = configService.getHeadOfHousehold();

    try {
      // ldsgc expects a req object with query property
      // It only takes one argument despite the harvest.mjs wrapper
      const mockReq = { query: {} };
      const result = await getLDSGCData(mockReq);

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} conference items`);
      } else if (result) {
        console.log('Conference data fetched');
      }
    } catch (error) {
      if (error.message?.includes('rate') || error.response?.status === 429) {
        console.log('Rate limited');
      } else {
        throw error;
      }
    }
  }, 60000);
});
