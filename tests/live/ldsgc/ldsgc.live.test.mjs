/**
 * LDS General Conference Live Integration Test
 *
 * Run with: npm test -- tests/live/ldsgc/ldsgc.live.test.mjs
 *
 * Fetches LDS General Conference talk data
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import getLDSGCData from '../../../backend/lib/ldsgc.mjs';

describe('LDSGC Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
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
