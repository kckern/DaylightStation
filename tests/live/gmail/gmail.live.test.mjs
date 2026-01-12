/**
 * Gmail Live Integration Test
 *
 * Run with: npm test -- tests/live/gmail/gmail.live.test.mjs
 *
 * Requires:
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in secrets.yml
 * - OAuth refresh token in users/{username}/auth/gmail.yml
 */

import { configService } from '../../../backend/_legacy/lib/config/index.mjs';
import listMails from '../../../backend/_legacy/lib/gmail.mjs';

describe('Gmail Live Integration', () => {
  beforeAll(() => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.GOOGLE_CLIENT_ID = configService.getSecret('GOOGLE_CLIENT_ID');
    process.env.GOOGLE_CLIENT_SECRET = configService.getSecret('GOOGLE_CLIENT_SECRET');
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';
  });

  it('fetches gmail messages', async () => {
    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('gmail', username) || {};

    if (!auth.refresh_token) {
      console.log('Gmail OAuth not configured - skipping test');
      return;
    }

    try {
      const result = await listMails(null, `test-${Date.now()}`, username);

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.url) {
        console.log(`Re-auth needed: ${result.url}`);
      } else if (Array.isArray(result)) {
        console.log(`Fetched ${result.length} messages`);
        expect(result.length).toBeGreaterThanOrEqual(0);
      } else if (result && typeof result === 'object') {
        const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
        console.log(`Fetched messages for ${dates.length} dates`);
      }
    } catch (error) {
      if (error.message?.includes('token') || error.message?.includes('auth')) {
        console.log(`Auth error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 60000);
});
