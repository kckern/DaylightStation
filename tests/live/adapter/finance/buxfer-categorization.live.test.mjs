/**
 * Buxfer Transaction Categorization Live Test
 *
 * Run with:
 *   node --experimental-vm-modules node_modules/.bin/jest tests/live/adapter/finance/buxfer-categorization.live.test.mjs
 *
 * Or via harness:
 *   node tests/live/adapter/harness.mjs --only=finance
 *
 * This test:
 * 1. Connects to real Buxfer API
 * 2. Uses real OpenAI for categorization
 * 3. Actually updates untagged transactions
 *
 * Requires:
 * - BUXFER_USERNAME/BUXFER_PASSWORD in secrets.yml
 * - OPENAI_API_KEY in secrets.yml
 */

import { jest } from '@jest/globals';
import axios from 'axios';
import { configService, initConfigService } from '#backend/src/0_system/config/index.mjs';
import { BuxferAdapter } from '#adapters/finance/BuxferAdapter.mjs';
import { OpenAIAdapter } from '#adapters/ai/OpenAIAdapter.mjs';
import { YamlFinanceDatastore } from '#adapters/persistence/yaml/YamlFinanceDatastore.mjs';
import { TransactionCategorizationService } from '#apps/finance/TransactionCategorizationService.mjs';

function getDataPath() {
  return process.env.DAYLIGHT_DATA_PATH || null;
}

// Increase timeout for API calls
jest.setTimeout(120000);

describe('Buxfer Categorization Live', () => {
  let buxferAdapter;
  let aiGateway;
  let financeStore;
  let categorizationService;
  let isConfigured = false;

  beforeAll(async () => {
    const dataPath = getDataPath();
    if (!dataPath) {
      console.log('Could not determine data path - skipping');
      return;
    }

    if (!configService.isReady()) {
      initConfigService(dataPath);
    }

    // Get credentials - Buxfer uses getUserAuth/getHouseholdAuth pattern
    const buxferAuth = configService.getUserAuth?.('buxfer') || configService.getHouseholdAuth?.('buxfer');
    const openaiKey = configService.getSecret('OPENAI_API_KEY');

    if (!buxferAuth?.email || !buxferAuth?.password) {
      console.log('Buxfer credentials not configured - skipping');
      console.log('Expected: getUserAuth("buxfer") or getHouseholdAuth("buxfer") with {email, password}');
      return;
    }

    if (!openaiKey) {
      console.log('OpenAI API key not configured - skipping');
      return;
    }

    const buxferEmail = buxferAuth.email;
    const buxferPassword = buxferAuth.password;

    const logger = {
      debug: (...args) => console.log('[DEBUG]', ...args),
      info: (...args) => console.log('[INFO]', ...args),
      warn: (...args) => console.log('[WARN]', ...args),
      error: (...args) => console.error('[ERROR]', ...args),
    };

    // Initialize real adapters
    buxferAdapter = new BuxferAdapter(
      { email: buxferEmail, password: buxferPassword },
      { httpClient: axios, logger }
    );

    aiGateway = new OpenAIAdapter(
      { apiKey: openaiKey },
      { httpClient: axios, logger }
    );

    financeStore = new YamlFinanceDatastore({ configService });

    categorizationService = new TransactionCategorizationService({
      aiGateway,
      transactionSource: buxferAdapter,
      financeStore,
      logger
    });

    isConfigured = true;
  });

  it('finds untagged transactions', async () => {
    if (!isConfigured) {
      console.log('Skipping - not configured');
      return;
    }

    // Fetch recent transactions
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`Fetching transactions from ${startDate} to ${endDate}...`);

    const transactions = await buxferAdapter.getTransactions({
      startDate,
      endDate
    });

    console.log(`Total transactions: ${transactions.length}`);

    // Find untagged
    const untagged = categorizationService.getUncategorized(transactions);
    console.log(`Untagged transactions: ${untagged.length}`);

    // Show sample
    if (untagged.length > 0) {
      console.log('\nSample untagged:');
      untagged.slice(0, 5).forEach(t => {
        console.log(`  ${t.id}: ${t.description} ($${t.amount})`);
      });
    }

    expect(transactions.length).toBeGreaterThan(0);
  });

  it('categorizes untagged transactions via AI', async () => {
    if (!isConfigured) {
      console.log('Skipping - not configured');
      return;
    }

    // Check for specific transaction from .env or use recent untagged
    const targetId = process.env.TEST_TRANSACTION_ID || '235351917';

    // Fetch recent transactions
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const transactions = await buxferAdapter.getTransactions({ startDate, endDate });
    const untagged = categorizationService.getUncategorized(transactions);

    if (untagged.length === 0) {
      console.log('No untagged transactions found - all caught up!');
      return;
    }

    // Find specific transaction or use first untagged
    let targetTransaction = untagged.find(t => t.id?.toString() === targetId);
    if (!targetTransaction) {
      targetTransaction = untagged[0];
      console.log(`Transaction ${targetId} not found or already tagged, using: ${targetTransaction.id}`);
    }

    console.log(`\nCategorizing: ${targetTransaction.id} - "${targetTransaction.description}"`);

    // Run categorization on just this one transaction
    const result = await categorizationService.categorize([targetTransaction]);

    console.log('\nResult:');
    console.log(`  Processed: ${result.processed.length}`);
    console.log(`  Failed: ${result.failed.length}`);
    console.log(`  Skipped: ${result.skipped.length}`);

    if (result.processed.length > 0) {
      const p = result.processed[0];
      console.log(`\n  ✓ ${p.originalDescription} → "${p.friendlyName}" [${p.category}]`);
    }

    if (result.failed.length > 0) {
      console.log(`\n  ✗ Failed: ${result.failed[0].reason}`);
    }

    // Verify it worked
    expect(result.processed.length + result.failed.length + result.skipped.length).toBe(1);
  });

  it('batch categorizes untagged budget transactions', async () => {
    if (!isConfigured) {
      console.log('Skipping - not configured');
      return;
    }

    const dryRun = process.env.DRY_RUN === 'true';
    const runBatch = process.env.BATCH_CATEGORIZE === 'true';

    if (!dryRun && !runBatch) {
      console.log('Set DRY_RUN=true to preview or BATCH_CATEGORIZE=true to run');
      return;
    }

    // Get budget accounts from config
    const budgetConfig = financeStore.getBudgetConfig();
    const budgetAccounts = budgetConfig?.budget?.[0]?.accounts || [];
    console.log('Budget accounts:', budgetAccounts);

    if (budgetAccounts.length === 0) {
      console.log('No budget accounts configured');
      return;
    }

    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    console.log(`\nFetching transactions from ${startDate} to ${endDate}...`);
    const transactions = await buxferAdapter.getTransactions({
      startDate,
      endDate,
      accounts: budgetAccounts  // Only budget accounts
    });

    const untagged = categorizationService.getUncategorized(transactions);

    console.log(`Total transactions from budget accounts: ${transactions.length}`);
    console.log(`Untagged: ${untagged.length}`);

    if (untagged.length === 0) {
      console.log('Nothing to categorize!');
      return;
    }

    if (dryRun) {
      console.log('\n=== DRY RUN - Would categorize: ===');
      untagged.forEach(t => {
        console.log(`  ${t.id}: ${t.accountName} - "${t.description}" ($${Math.abs(t.amount)})`);
      });
      console.log(`\nTotal: ${untagged.length} transactions would be categorized`);
      console.log('Run with BATCH_CATEGORIZE=true to actually tag them');
      return;
    }

    // Process in batches of 5 to avoid rate limits
    const batchSize = 5;
    let totalProcessed = 0;
    let totalFailed = 0;

    for (let i = 0; i < untagged.length; i += batchSize) {
      const batch = untagged.slice(i, i + batchSize);
      console.log(`\nProcessing batch ${Math.floor(i / batchSize) + 1} (${batch.length} transactions)...`);

      const result = await categorizationService.categorize(batch);

      totalProcessed += result.processed.length;
      totalFailed += result.failed.length;

      result.processed.forEach(p => {
        console.log(`  ✓ ${p.id}: "${p.friendlyName}" [${p.category}]`);
      });

      result.failed.forEach(f => {
        console.log(`  ✗ ${f.id}: ${f.reason}`);
      });

      // Rate limit protection
      if (i + batchSize < untagged.length) {
        console.log('  Waiting 2s for rate limit...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log(`\n========================================`);
    console.log(`Total processed: ${totalProcessed}`);
    console.log(`Total failed: ${totalFailed}`);
    console.log(`========================================`);
  });
});
