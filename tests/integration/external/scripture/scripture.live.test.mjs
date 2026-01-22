/**
 * Scripture Guide Live Integration Test
 *
 * Run with: npm test -- tests/live/scripture/scripture.live.test.mjs
 *
 * Fetches scripture reading guide data
 */

import { configService } from '#backend/_legacy/lib/config/index.mjs';
import getScriptureGuide from '#backend/_legacy/lib/scriptureguide.mjs';

describe('Scripture Guide Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }
  });

  it('fetches scripture guide data', async () => {
    const username = configService.getHeadOfHousehold();

    try {
      const result = await getScriptureGuide(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (result) {
        console.log('Scripture guide data fetched');
        if (result.today) {
          console.log(`Today's reading: ${result.today.reference || result.today}`);
        }
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
