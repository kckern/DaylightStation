// tests/unit/domains/finance/entities/Account.test.mjs
import { Account } from '../../../../../backend/src/1_domains/finance/entities/Account.mjs';

describe('Account', () => {
  let account;

  beforeEach(() => {
    account = new Account({
      id: 'checking-001',
      name: 'Main Checking',
      type: 'checking',
      balance: 5000,
      currency: 'USD'
    });
  });

  describe('constructor', () => {
    test('creates account with properties', () => {
      expect(account.id).toBe('checking-001');
      expect(account.name).toBe('Main Checking');
      expect(account.balance).toBe(5000);
    });

    test('defaults balance to 0', () => {
      const a = new Account({ id: 'test', name: 'Test', type: 'checking' });
      expect(a.balance).toBe(0);
    });
  });

  describe('isAsset', () => {
    test('returns true for checking', () => {
      expect(account.isAsset()).toBe(true);
    });

    test('returns true for savings', () => {
      account.type = 'savings';
      expect(account.isAsset()).toBe(true);
    });

    test('returns false for credit', () => {
      account.type = 'credit';
      expect(account.isAsset()).toBe(false);
    });
  });

  describe('isLiability', () => {
    test('returns false for checking', () => {
      expect(account.isLiability()).toBe(false);
    });

    test('returns true for credit', () => {
      account.type = 'credit';
      expect(account.isLiability()).toBe(true);
    });

    test('returns true for loan', () => {
      account.type = 'loan';
      expect(account.isLiability()).toBe(true);
    });
  });

  describe('updateBalance', () => {
    test('updates balance', () => {
      account.updateBalance(6000);
      expect(account.balance).toBe(6000);
    });

    test('updates lastUpdated', () => {
      account.updateBalance(6000);
      expect(account.lastUpdated).toBeDefined();
    });
  });

  describe('applyTransaction', () => {
    test('adds to balance', () => {
      account.applyTransaction(100);
      expect(account.balance).toBe(5100);
    });

    test('subtracts from balance', () => {
      account.applyTransaction(-200);
      expect(account.balance).toBe(4800);
    });
  });

  describe('getAbsoluteBalance', () => {
    test('returns absolute value', () => {
      account.balance = -500;
      expect(account.getAbsoluteBalance()).toBe(500);
    });
  });

  describe('toJSON/fromJSON', () => {
    test('round-trips account data', () => {
      const json = account.toJSON();
      const restored = Account.fromJSON(json);
      expect(restored.id).toBe(account.id);
      expect(restored.balance).toBe(account.balance);
    });
  });
});
