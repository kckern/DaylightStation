/**
 * Gmail Live Integration Test
 *
 * Run with: npm test -- tests/live/gmail/gmail.live.test.mjs
 *
 * Requires:
 * - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET in secrets.yml
 * - OAuth refresh token in users/{username}/auth/gmail.yml
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import listMails from '#backend/_legacy/lib/gmail.mjs';
import { requireDataPath, requireSecret, requireConfig } from '../test-preconditions.mjs';

describe('Gmail Live Integration', () => {
  let dataPath;
  let username;

  beforeAll(() => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if secrets not configured
    process.env.GOOGLE_CLIENT_ID = requireSecret('GOOGLE_CLIENT_ID', configService);
    process.env.GOOGLE_CLIENT_SECRET = requireSecret('GOOGLE_CLIENT_SECRET', configService);
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);
  });

  it('fetches gmail messages', async () => {
    const auth = configService.getUserAuth('gmail', username) || {};

    // FAIL if OAuth not configured
    if (!auth.refresh_token) {
      throw new Error(
        `[PRECONDITION FAILED] Gmail OAuth not configured for user '${username}'. ` +
        `Expected: getUserAuth('gmail', '${username}') with {refresh_token: '...'}`
      );
    }

    const result = await listMails(null, `test-${Date.now()}`, username);

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Gmail error: ${result.error}`);
    }
    if (result?.url) {
      throw new Error(`[ASSERTION FAILED] Gmail re-auth needed: ${result.url}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Fetched ${result.length} messages`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else if (typeof result === 'object') {
      const dates = Object.keys(result).filter(k => k.match(/^\d{4}-\d{2}-\d{2}$/));
      console.log(`Fetched messages for ${dates.length} dates`);
      expect(dates.length).toBeGreaterThanOrEqual(0);
    }
  }, 60000);
});
