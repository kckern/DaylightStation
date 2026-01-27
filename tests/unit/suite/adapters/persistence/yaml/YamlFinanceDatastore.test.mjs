/**
 * YamlFinanceDatastore Tests
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { YamlFinanceDatastore } from '#backend/src/2_adapters/persistence/yaml/YamlFinanceDatastore.mjs';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import os from 'os';

describe('YamlFinanceDatastore', () => {
  let store;
  let testDataRoot;

  const mockBudgetConfig = {
    budget: [{ timeframe: { start: '2026-01-01', end: '2026-06-30' } }],
    mortgage: { accounts: ['Mortgage'], startDate: '2020-01-01' }
  };

  const mockTransactions = [
    { id: '1', date: '2026-01-15', amount: 50, description: 'Test 1' },
    { id: '2', date: '2026-01-20', amount: 100, description: 'Test 2' }
  ];

  beforeEach(() => {
    // Create temp directory for tests
    testDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-store-test-'));

    // Create directory structure
    const financesPath = path.join(testDataRoot, 'households', 'default', 'apps', 'finances');
    fs.mkdirSync(financesPath, { recursive: true });

    // Write test config file
    fs.writeFileSync(
      path.join(financesPath, 'budget.config.yml'),
      yaml.dump(mockBudgetConfig)
    );

    store = new YamlFinanceDatastore({ dataRoot: testDataRoot });
  });

  afterEach(() => {
    // Clean up temp directory
    fs.rmSync(testDataRoot, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('throws if dataRoot is missing', () => {
      expect(() => new YamlFinanceDatastore({})).toThrow('requires dataRoot');
    });

    it('uses default household ID', () => {
      const basePath = store.getBasePath();
      expect(basePath).toContain('households/default/apps/finances');
    });

    it('allows custom default household ID', () => {
      const customStore = new YamlFinanceDatastore({
        dataRoot: testDataRoot,
        defaultHouseholdId: 'custom'
      });
      const basePath = customStore.getBasePath();
      expect(basePath).toContain('households/custom/apps/finances');
    });
  });

  describe('getBasePath', () => {
    it('returns correct path for default household', () => {
      const basePath = store.getBasePath();
      expect(basePath).toBe(path.join(testDataRoot, 'households', 'default', 'apps', 'finances'));
    });

    it('returns correct path for specified household', () => {
      const basePath = store.getBasePath('other');
      expect(basePath).toBe(path.join(testDataRoot, 'households', 'other', 'apps', 'finances'));
    });
  });

  describe('getBudgetConfig / saveBudgetConfig', () => {
    it('reads budget configuration', () => {
      const config = store.getBudgetConfig();
      expect(config).toEqual(mockBudgetConfig);
    });

    it('returns null for missing config', () => {
      const config = store.getBudgetConfig('nonexistent');
      expect(config).toBeNull();
    });

    it('saves budget configuration', () => {
      const newConfig = { ...mockBudgetConfig, updated: true };
      store.saveBudgetConfig(newConfig);

      const loaded = store.getBudgetConfig();
      expect(loaded.updated).toBe(true);
    });
  });

  describe('getCompiledFinances / saveCompiledFinances', () => {
    it('saves and retrieves compiled finances', () => {
      const finances = { budgets: { '2026-01-01': {} }, mortgage: { balance: 250000 } };

      store.saveCompiledFinances(finances);
      const loaded = store.getCompiledFinances();

      expect(loaded).toEqual(finances);
    });

    it('returns null when file does not exist', () => {
      const finances = store.getCompiledFinances('nonexistent');
      expect(finances).toBeNull();
    });
  });

  describe('getTransactions / saveTransactions', () => {
    it('saves and retrieves transactions for a budget period', () => {
      store.saveTransactions('2026-01-01', mockTransactions);

      const loaded = store.getTransactions('2026-01-01');
      expect(loaded).toEqual(mockTransactions);
    });

    it('creates directory structure when saving', () => {
      store.saveTransactions('2026-07-01', mockTransactions);

      const txnPath = path.join(store.getBasePath(), '2026-07-01', 'transactions.yml');
      expect(fs.existsSync(txnPath)).toBe(true);
    });

    it('returns null for missing transactions', () => {
      const transactions = store.getTransactions('2099-01-01');
      expect(transactions).toBeNull();
    });
  });

  describe('getAllTransactions', () => {
    it('loads transactions from multiple periods', () => {
      store.saveTransactions('2026-01-01', [mockTransactions[0]]);
      store.saveTransactions('2026-02-01', [mockTransactions[1]]);

      const all = store.getAllTransactions(['2026-01-01', '2026-02-01']);
      expect(all).toHaveLength(2);
    });

    it('skips periods with no transactions', () => {
      store.saveTransactions('2026-01-01', mockTransactions);

      const all = store.getAllTransactions(['2026-01-01', '2026-02-01']);
      expect(all).toEqual(mockTransactions);
    });
  });

  describe('getAccountBalances / saveAccountBalances', () => {
    const mockBalances = [
      { name: 'Checking', balance: 5000 },
      { name: 'Credit', balance: -500 }
    ];

    it('saves and retrieves account balances', () => {
      store.saveAccountBalances(mockBalances);

      const loaded = store.getAccountBalances();
      expect(loaded).toEqual(mockBalances);
    });
  });

  describe('getMortgageTransactions / saveMortgageTransactions', () => {
    const mockMortgageTxns = [
      { id: '1', date: '2026-01-01', amount: 2000 }
    ];

    it('saves and retrieves mortgage transactions', () => {
      store.saveMortgageTransactions(mockMortgageTxns);

      const loaded = store.getMortgageTransactions();
      expect(loaded).toEqual(mockMortgageTxns);
    });
  });

  describe('getMemos / getMemo / saveMemo', () => {
    it('saves and retrieves a memo', () => {
      store.saveMemo('123', 'This is a test memo');

      const memo = store.getMemo('123');
      expect(memo).toBe('This is a test memo');
    });

    it('retrieves all memos', () => {
      store.saveMemo('123', 'Memo 1');
      store.saveMemo('456', 'Memo 2');

      const memos = store.getMemos();
      expect(memos['123']).toBe('Memo 1');
      expect(memos['456']).toBe('Memo 2');
    });

    it('returns null for missing memo', () => {
      const memo = store.getMemo('nonexistent');
      expect(memo).toBeNull();
    });
  });

  describe('applyMemos', () => {
    it('applies memos to transactions', () => {
      store.saveMemo('1', 'Memo for transaction 1');

      const transactions = [...mockTransactions];
      const result = store.applyMemos(transactions);

      expect(result[0].memo).toBe('Memo for transaction 1');
      expect(result[1].memo).toBeUndefined();
    });
  });

  describe('getCategorizationConfig', () => {
    it('returns categorization config', () => {
      const gptConfig = { validTags: ['Groceries'], chat: [] };
      const gptPath = path.join(store.getBasePath(), 'gpt.yml');
      fs.writeFileSync(gptPath, yaml.dump(gptConfig));

      const config = store.getCategorizationConfig();
      expect(config).toEqual(gptConfig);
    });

    it('returns null when config is missing', () => {
      const config = store.getCategorizationConfig('nonexistent');
      expect(config).toBeNull();
    });
  });

  describe('exists', () => {
    it('returns true when budget config exists', () => {
      expect(store.exists()).toBe(true);
    });

    it('returns false when budget config does not exist', () => {
      expect(store.exists('nonexistent')).toBe(false);
    });
  });

  describe('listBudgetPeriods', () => {
    it('lists directories with transactions', () => {
      store.saveTransactions('2026-01-01', mockTransactions);
      store.saveTransactions('2026-02-01', mockTransactions);

      const periods = store.listBudgetPeriods();
      expect(periods).toContain('2026-01-01');
      expect(periods).toContain('2026-02-01');
    });

    it('filters out non-date directories', () => {
      // Create a non-date directory
      const badPath = path.join(store.getBasePath(), 'not-a-date');
      fs.mkdirSync(badPath, { recursive: true });

      store.saveTransactions('2026-01-01', mockTransactions);

      const periods = store.listBudgetPeriods();
      expect(periods).toContain('2026-01-01');
      expect(periods).not.toContain('not-a-date');
    });

    it('returns sorted list', () => {
      store.saveTransactions('2026-03-01', mockTransactions);
      store.saveTransactions('2026-01-01', mockTransactions);
      store.saveTransactions('2026-02-01', mockTransactions);

      const periods = store.listBudgetPeriods();
      expect(periods).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    });

    it('returns empty array for nonexistent path', () => {
      const periods = store.listBudgetPeriods('nonexistent');
      expect(periods).toEqual([]);
    });
  });
});
