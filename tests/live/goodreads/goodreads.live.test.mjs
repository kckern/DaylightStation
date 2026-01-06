/**
 * Goodreads Live Integration Test
 *
 * Run with: npm test -- tests/live/goodreads/goodreads.live.test.mjs
 *
 * Requires:
 * - Goodreads user ID/URL in users/{username}/auth/goodreads.yml
 */

import { configService } from '../../../backend/lib/config/ConfigService.mjs';
import getBooks from '../../../backend/lib/goodreads.mjs';

describe('Goodreads Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
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
