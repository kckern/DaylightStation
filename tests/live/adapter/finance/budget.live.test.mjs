/**
 * Budget Live Integration Test
 *
 * Run with: npm test -- tests/live/budget/budget.live.test.mjs
 *
 * Requires:
 * - Buxfer API credentials in secrets.yml or user auth
 *
 * Note: budget.mjs reads process.env.path.data at module load time,
 * so we must set it before importing.
 *
 * IMPORTANT: This test will FAIL if preconditions aren't met.
 * It will NOT silently pass. This is intentional.
 */

import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { getDataPath } from '../../../_lib/configHelper.mjs';
import { requireDataPath, requireConfig, SkipTestError } from '../test-preconditions.mjs';

// Must set process.env.path before importing budget.mjs
const dataPath = getDataPath();
if (!dataPath) {
  throw new Error('[PRECONDITION FAILED] Data path not configured. Set DAYLIGHT_DATA_PATH.');
}
process.env.path = { data: dataPath };

let refreshFinancialData;
let moduleError = null;
try {
  const mod = await import('#backend/lib/budget.mjs');
  refreshFinancialData = mod.refreshFinancialData;
} catch (e) {
  moduleError = e.message;
}

describe('Budget Live Integration', () => {
  beforeAll(() => {
    // FAIL if data path not configured
    requireDataPath(getDataPath);

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // FAIL if module didn't load
    if (moduleError || !refreshFinancialData) {
      throw new Error(
        `[PRECONDITION FAILED] Budget module not loaded: ${moduleError || 'unknown error'}. ` +
        'Note: budget.mjs requires full server environment with process.env.path'
      );
    }

    // Get Buxfer credentials
    const buxferUsername = configService.getSecret('BUXFER_USERNAME');
    const buxferPassword = configService.getSecret('BUXFER_PASSWORD');

    // FAIL if credentials not configured
    requireConfig('BUXFER_USERNAME', buxferUsername);
    requireConfig('BUXFER_PASSWORD', buxferPassword);

    process.env.BUXFER_USERNAME = buxferUsername;
    process.env.BUXFER_PASSWORD = buxferPassword;
  });

  it('refreshes financial data', async () => {
    const username = configService.getHeadOfHousehold();
    requireConfig('Head of household', username);

    const result = await refreshFinancialData(`test-${Date.now()}`, { targetUsername: username });

    // Explicit skip for rate limiting
    if (result?.skipped) {
      throw new SkipTestError(`Budget skipped: ${result.reason}`);
    }

    // FAIL on errors - don't silently pass
    if (result?.error) {
      throw new Error(`[ASSERTION FAILED] Budget refresh error: ${result.error}`);
    }

    // Verify we got actual results
    expect(result).toBeTruthy();

    console.log('Budget data refreshed');
    if (result.accounts) {
      console.log(`Accounts: ${result.accounts.length}`);
      expect(result.accounts.length).toBeGreaterThan(0);
    }
    if (result.transactions) {
      console.log(`Transactions: ${result.transactions.length}`);
      expect(result.transactions.length).toBeGreaterThanOrEqual(0);
    }
  }, 120000);
});
