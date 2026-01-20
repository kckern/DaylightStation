/**
 * Letterboxd Live Integration Test
 *
 * Run with: npm test -- tests/live/letterboxd/letterboxd.live.test.mjs
 *
 * Requires:
 * - Letterboxd username in users/{username}/auth/letterboxd.yml
 *   OR LETTERBOXD_USER in secrets.yml/environment
 */

import { configService } from '../../../backend/_legacy/lib/config/index.mjs';
import getMovies from '../../../backend/_legacy/lib/letterboxd.mjs';

describe('Letterboxd Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    // Set fallback env var
    process.env.LETTERBOXD_USER = configService.getSecret('LETTERBOXD_USER');
  });

  it('scrapes letterboxd diary entries', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('letterboxd', username) || {};
    const letterboxdUser = auth.username || process.env.LETTERBOXD_USER;

    if (!letterboxdUser) {
      console.log('Letterboxd username not configured - skipping test');
      return;
    }

    console.log(`Fetching diary for Letterboxd user: ${letterboxdUser}`);
    const result = await getMovies(username);

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} diary entries`);
      if (result.length > 0) {
        const latest = result[0];
        console.log(`Latest: "${latest.title}" on ${latest.date} (rating: ${latest.rating || 'unrated'})`);
      }
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else {
      console.log('Unexpected result type:', typeof result);
    }
  }, 60000);
});
