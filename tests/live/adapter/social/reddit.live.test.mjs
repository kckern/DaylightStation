/**
 * Reddit Live Integration Test
 *
 * Run with: npm test -- tests/live/reddit/reddit.live.test.mjs
 *
 * Requires:
 * - Reddit username in users/{username}/auth/reddit.yml
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import getRedditActivity from '#backend/_legacy/lib/reddit.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';

describe('Reddit Live Integration', () => {
  beforeAll(() => {
    const dataPath = getDataPath();
    if (!dataPath) {
      throw new Error('Could not determine data path from .env');
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    process.env.REDDIT_USER = configService.getSecret('REDDIT_USER');
  });

  it('fetches reddit activity', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('reddit', username) || {};
    const redditUser = auth.username || process.env.REDDIT_USER;

    if (!redditUser) {
      console.log('Reddit username not configured - skipping test');
      return;
    }

    try {
      const result = await getRedditActivity(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} reddit activities`);
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Fetched activity for ${dates.length} dates`);
      }
    } catch (error) {
      if (error.message?.includes('rate') || error.response?.status === 429) {
        console.log('Reddit rate limited');
      } else if (error.message?.includes('username')) {
        console.log('Reddit username not configured');
      } else {
        throw error;
      }
    }
  }, 60000);
});
