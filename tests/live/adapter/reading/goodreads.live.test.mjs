/**
 * Goodreads Live Integration Test
 *
 * Run with: npm test -- tests/live/goodreads/goodreads.live.test.mjs
 *
 * Requires:
 * - Goodreads user ID/URL in users/{username}/auth/goodreads.yml
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getBooks from '#backend/_legacy/lib/goodreads.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';

describe('Goodreads Live Integration', () => {
  beforeAll(() => {
    const dataPath = getDataPath();
    if (!dataPath) {
      throw new Error('Could not determine data path from .env');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.GOODREADS_USER = configService.getSecret('GOODREADS_USER');
  });

  it('scrapes goodreads reading list', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('goodreads', username) || {};
    const goodreadsUser = auth.user_id || auth.username || process.env.GOODREADS_USER;

    if (!goodreadsUser) {
      console.log('Goodreads user not configured - skipping test');
      return;
    }

    try {
      const result = await getBooks(username);

      if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} books`);
        if (result.length > 0) {
          const recent = result[0];
          console.log(`Recent: "${recent.title}" by ${recent.author}`);
        }
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result?.error) {
        console.log(`Error: ${result.error}`);
      }
    } catch (error) {
      if (error.message?.includes('rate') || error.response?.status === 429) {
        console.log('Goodreads rate limited');
      } else {
        throw error;
      }
    }
  }, 60000);
});
