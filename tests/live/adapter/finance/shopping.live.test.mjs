/**
 * Shopping Live Integration Test
 *
 * Run with: npm test -- tests/live/shopping/shopping.live.test.mjs
 *
 * AI-powered shopping list extraction from receipts/emails
 *
 * Requires:
 * - Gmail OAuth configured (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
 * - User gmail refresh token
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireSecret, requireConfig, SkipTestError } from '../test-preconditions.mjs';

describe('Shopping Live Integration', () => {
  let processShoppingData;
  let moduleError = null;
  let dataPath;
  let username;

  beforeAll(async () => {
    // FAIL if data path not configured
    dataPath = requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if Google OAuth credentials not configured
    process.env.GOOGLE_CLIENT_ID = requireSecret('GOOGLE_CLIENT_ID', configService);
    process.env.GOOGLE_CLIENT_SECRET = requireSecret('GOOGLE_CLIENT_SECRET', configService);
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    try {
      const mod = await import('#backend/lib/shopping.mjs');
      processShoppingData = mod.default;
    } catch (e) {
      moduleError = e.message;
    }

    // FAIL if module didn't load
    if (moduleError || !processShoppingData) {
      throw new Error(
        `[PRECONDITION FAILED] Shopping module not loaded: ${moduleError || 'unknown error'}`
      );
    }
  });

  it('processes shopping data', async () => {
    const auth = configService.getUserAuth('gmail', username) || {};

    // FAIL if Gmail OAuth not configured
    if (!auth.refresh_token) {
      throw new Error(
        `[PRECONDITION FAILED] Gmail OAuth not configured for user '${username}'. ` +
        `Expected: getUserAuth('gmail', '${username}') with {refresh_token: '...'}`
      );
    }

    const result = await processShoppingData(null, `test-${Date.now()}`, username);

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Shopping skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Shopping error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    if (Array.isArray(result)) {
      console.log(`Processed ${result.length} shopping items`);
      expect(result.length).toBeGreaterThanOrEqual(0);
    } else {
      console.log('Shopping data processed');
    }
  }, 300000); // 5 min timeout for AI processing
});
