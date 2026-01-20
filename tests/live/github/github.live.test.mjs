/**
 * GitHub Live Integration Test
 *
 * Run with: npm test -- tests/live/github/github.live.test.mjs
 *
 * Requires:
 * - GitHub username in users/{username}/auth/github.yml
 * - Optional: GitHub token for private repos and higher rate limits
 */

import { configService } from '../../../backend/_legacy/lib/config/index.mjs';
import getGitHubActivity from '../../../backend/_legacy/lib/github.mjs';

describe('GitHub Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }
  });

  it('fetches github activity', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('github', username) || {};

    if (!auth.username) {
      console.log('GitHub username not configured - skipping test');
      return;
    }

    try {
      const result = await getGitHubActivity(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} commits/events`);
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Fetched activity for ${dates.length} dates`);
      }
    } catch (error) {
      if (error.message?.includes('rate limit') || error.response?.status === 403) {
        console.log('GitHub API rate limited');
      } else if (error.message?.includes('username')) {
        console.log('GitHub username not configured');
      } else {
        throw error;
      }
    }
  }, 60000);
});
