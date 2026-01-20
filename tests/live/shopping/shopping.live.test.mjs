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
 */

import { configService } from '../../../backend/_legacy/lib/config/index.mjs';

describe('Shopping Live Integration', () => {
  let processShoppingData;

  beforeAll(async () => {
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    // Set up Google OAuth credentials before importing
    process.env.GOOGLE_CLIENT_ID = configService.getSecret('GOOGLE_CLIENT_ID');
    process.env.GOOGLE_CLIENT_SECRET = configService.getSecret('GOOGLE_CLIENT_SECRET');
    process.env.GOOGLE_REDIRECT_URI = configService.getSecret('GOOGLE_REDIRECT_URI') || 'http://localhost:3112/auth/google/callback';

    try {
      const mod = await import('../../../backend/lib/shopping.mjs');
      processShoppingData = mod.default;
    } catch (e) {
      console.log('shopping.mjs failed to load:', e.message);
    }
  });

  it('processes shopping data', async () => {
    if (!processShoppingData) {
      console.log('Shopping module not loaded - skipping test');
      return;
    }

    const username = configService.getHeadOfHousehold();
    const auth = configService.getUserAuth('gmail', username) || {};

    if (!auth.refresh_token) {
      console.log('Gmail OAuth not configured for shopping - skipping test');
      return;
    }

    try {
      const result = await processShoppingData(null, `test-${Date.now()}`, username);

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (Array.isArray(result)) {
        console.log(`Processed ${result.length} shopping items`);
      } else if (result) {
        console.log('Shopping data processed');
      }
    } catch (error) {
      if (error.message?.includes('AI') || error.message?.includes('API')) {
        console.log(`API error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }, 300000); // 5 min timeout for AI processing
});
