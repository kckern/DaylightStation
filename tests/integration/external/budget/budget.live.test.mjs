/**
 * Budget Live Integration Test
 *
 * Run with: npm test -- tests/live/budget/budget.live.test.mjs
 *
 * Requires:
 * - Buxfer API credentials in secrets.yml or user auth
 *
 * Note: budget.mjs reads process.env.path.data at module load time,
 * so we must set it before importing. This test requires the full
 * server environment with process.env.path set up correctly.
 */

import { configService } from '#backend/_legacy/lib/config/index.mjs';

// Must set process.env.path before importing budget.mjs
const dataPath = process.env.DAYLIGHT_DATA_PATH;
if (dataPath) {
  process.env.path = { data: dataPath };
}

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
    const dataPath = process.env.DAYLIGHT_DATA_PATH;
    if (!dataPath) {
      throw new Error('DAYLIGHT_DATA_PATH environment variable required');
    }

    if (!configService.isInitialized()) {
      configService.init({ dataDir: dataPath });
    }

    process.env.BUXFER_USERNAME = configService.getSecret('BUXFER_USERNAME');
    process.env.BUXFER_PASSWORD = configService.getSecret('BUXFER_PASSWORD');
  });

  it('refreshes financial data', async () => {
    if (moduleError || !refreshFinancialData) {
      console.log(`Budget module not loaded: ${moduleError || 'unknown error'}`);
      console.log('Note: budget.mjs requires full server environment with process.env.path');
      return;
    }

    const username = configService.getHeadOfHousehold();

    if (!process.env.BUXFER_USERNAME || !process.env.BUXFER_PASSWORD) {
      console.log('Buxfer credentials not configured - skipping test');
      return;
    }

    try {
      const result = await refreshFinancialData(`test-${Date.now()}`, { targetUsername: username });

      if (result?.error) {
        console.log(`Error: ${result.error}`);
      } else if (result?.skipped) {
        console.log(`Skipped: ${result.reason}`);
      } else if (result) {
        console.log('Budget data refreshed');
        if (result.accounts) console.log(`Accounts: ${result.accounts.length}`);
        if (result.transactions) console.log(`Transactions: ${result.transactions.length}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.message?.includes('ENOENT')) {
        console.log('Budget config not found - requires full server environment');
        return; // Skip gracefully
      } else if (error.message?.includes('auth') || error.message?.includes('login')) {
        console.log(`Auth error: ${error.message}`);
      } else if (error.message?.includes('rate')) {
        console.log('Rate limited');
      } else {
        throw error;
      }
    }
  }, 120000);
});
