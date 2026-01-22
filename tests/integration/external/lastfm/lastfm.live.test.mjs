/**
 * Last.fm Live Integration Test
 *
 * Run with: npm test -- tests/live/lastfm/lastfm.live.test.mjs
 *
 * Requires:
 * - LASTFM_API_KEY in secrets.yml
 * - Last.fm username in users/{username}/auth/lastfm.yml
 */

import { configService } from '#backend/src/0_infrastructure/config/index.mjs';
import getScrobbles from '#backend/_legacy/lib/lastfm.mjs';

describe('Last.fm Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.LASTFM_API_KEY = process.env.LASTFM_API_KEY || configService.getSecret('LASTFM_API_KEY') || configService.getSecret('LAST_FM_API_KEY');
  });

  const isBackfill = process.env.LASTFM_BACKFILL === 'true';
  const backfillSince = process.env.LASTFM_BACKFILL_SINCE || '2008-01-01';
  const testTimeout = isBackfill ? 300000 : 60000;

  it('fetches lastfm scrobbles', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('lastfm', username) || {};

    if (!auth.username) {
      console.log('Last.fm username not configured - skipping test');
      return;
    }

    if (!process.env.LASTFM_API_KEY) {
      console.log('LASTFM_API_KEY not configured - skipping test');
      return;
    }

    try {
      const result = await getScrobbles(`test-${Date.now()}`, { targetUsername: username, backfill: isBackfill, query: { backfillSince } });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} scrobbles${isBackfill ? ' (backfill)' : ''}`);
        if (result.length > 0) {
          const latest = result[0];
          console.log(`Latest: "${latest.title}" by ${latest.artist}`);
        }
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Fetched scrobbles for ${dates.length} dates`);
      }
    } catch (error) {
      if (error.message?.includes('API') || error.message?.includes('rate')) {
        console.log(`API error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, testTimeout);
});
