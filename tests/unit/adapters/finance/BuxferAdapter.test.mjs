// tests/unit/adapters/finance/BuxferAdapter.test.mjs
import { jest } from '@jest/globals';
import { BuxferAdapter } from '../../../../backend/src/2_adapters/finance/BuxferAdapter.mjs';

describe('BuxferAdapter', () => {
  let adapter;
  let mockHttpClient;
  let mockGetCredentials;
  let mockLogger;

  const validCredentials = {
    email: 'test@example.com',
    password: 'secret123'
  };

  beforeEach(() => {
    mockHttpClient = {
      get: jest.fn(),
      post: jest.fn()
    };

    mockGetCredentials = jest.fn().mockReturnValue(validCredentials);

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    adapter = new BuxferAdapter({
      httpClient: mockHttpClient,
      getCredentials: mockGetCredentials,
      logger: mockLogger
    });
  });

  describe('getToken', () => {
    test('authenticates and returns token', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { token: 'test-token-123' } }
      });

      const token = await adapter.getToken();

      expect(token).toBe('test-token-123');
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        'https://www.buxfer.com/api/login',
        { email: 'test@example.com', password: 'secret123' }
      );
    });

    test('caches token on subsequent calls', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { token: 'cached-token' } }
      });

      await adapter.getToken();
      await adapter.getToken();

      expect(mockHttpClient.post).toHaveBeenCalledTimes(1);
    });

    test('throws when credentials missing', async () => {
      mockGetCredentials.mockReturnValue({});

      await expect(adapter.getToken()).rejects.toThrow('Buxfer credentials not configured');
    });

    test('throws when login fails', async () => {
      mockHttpClient.post.mockRejectedValue(new Error('Network error'));

      await expect(adapter.getToken()).rejects.toThrow('Buxfer authentication failed');
    });
  });

  describe('request', () => {
    beforeEach(() => {
      // Pre-authenticate
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    test('makes GET request with params', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: { response: { accounts: [] } }
      });

      const result = await adapter.request('accounts', { foo: 'bar' });

      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('token=test-token')
      );
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining('foo=bar')
      );
    });

    test('makes POST request', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { success: true } }
      });

      const result = await adapter.request('transaction_edit', { id: '123' }, 'POST');

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('transaction_edit'),
        { id: '123' }
      );
    });

    test('increments metrics on request', async () => {
      mockHttpClient.get.mockResolvedValue({ data: { response: {} } });

      await adapter.request('accounts');

      expect(adapter.metrics.requests).toBe(1);
    });

    test('increments error count on failure', async () => {
      mockHttpClient.get.mockRejectedValue(new Error('API error'));

      await expect(adapter.request('accounts')).rejects.toThrow();
      expect(adapter.metrics.errors).toBe(1);
    });
  });

  describe('ITransactionSource implementation', () => {
    beforeEach(() => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    describe('findByCategory', () => {
      test('fetches transactions by tag', async () => {
        // First call: getAccounts
        mockHttpClient.get
          .mockResolvedValueOnce({
            data: { response: { accounts: [{ name: 'Checking' }] } }
          })
          // Second call: transactions for Checking with tag
          .mockResolvedValueOnce({
            data: {
              response: {
                transactions: [
                  { id: 1, date: '2026-01-01', amount: -50, description: 'Groceries', tagNames: ['Food'] }
                ]
              }
            }
          })
          // Third call: pagination check (empty)
          .mockResolvedValue({ data: { response: { transactions: [] } } });

        const result = await adapter.findByCategory('Food', '2026-01-01', '2026-01-31');

        expect(result).toHaveLength(1);
        expect(result[0].category).toBe('Food');
        expect(mockHttpClient.get).toHaveBeenCalledWith(
          expect.stringContaining('tagName=Food')
        );
      });
    });

    describe('findInRange', () => {
      test('fetches transactions in date range', async () => {
        mockHttpClient.get
          .mockResolvedValueOnce({
            data: { response: { accounts: [{ name: 'Checking' }] } }
          })
          .mockResolvedValueOnce({
            data: {
              response: {
                transactions: [
                  { id: 1, date: '2026-01-15', amount: -100, description: 'Test' }
                ]
              }
            }
          })
          .mockResolvedValue({ data: { response: { transactions: [] } } });

        const result = await adapter.findInRange('2026-01-01', '2026-01-31');

        expect(Array.isArray(result)).toBe(true);
      });
    });

    describe('findByAccount', () => {
      test('fetches transactions for account', async () => {
        mockHttpClient.get
          .mockResolvedValueOnce({
            data: {
              response: {
                transactions: [
                  { id: 1, date: '2026-01-01', amount: 500, description: 'Deposit', accountId: 123 }
                ]
              }
            }
          })
          .mockResolvedValue({ data: { response: { transactions: [] } } });

        const result = await adapter.findByAccount('Checking');

        expect(Array.isArray(result)).toBe(true);
        expect(mockHttpClient.get).toHaveBeenCalledWith(
          expect.stringContaining('accountName=Checking')
        );
      });
    });
  });

  describe('getAccountBalances', () => {
    beforeEach(() => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    test('returns Account entities', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          response: {
            accounts: [
              { id: 1, name: 'Checking', balance: 1000, type: 'checking', currency: 'USD' },
              { id: 2, name: 'Savings', balance: 5000, type: 'savings', currency: 'USD' }
            ]
          }
        }
      });

      const accounts = await adapter.getAccountBalances();

      expect(accounts).toHaveLength(2);
      expect(accounts[0].name).toBe('Checking');
      expect(accounts[0].balance).toBe(1000);
      expect(accounts[0].isAsset()).toBe(true);
    });

    test('filters by account names', async () => {
      mockHttpClient.get.mockResolvedValue({
        data: {
          response: {
            accounts: [
              { id: 1, name: 'Checking', balance: 1000, type: 'checking' },
              { id: 2, name: 'Savings', balance: 5000, type: 'savings' },
              { id: 3, name: 'Credit Card', balance: -500, type: 'credit card' }
            ]
          }
        }
      });

      const accounts = await adapter.getAccountBalances(['Checking', 'Savings']);

      expect(accounts).toHaveLength(2);
      expect(accounts.find(a => a.name === 'Credit Card')).toBeUndefined();
    });
  });

  describe('updateTransaction', () => {
    beforeEach(() => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    test('updates transaction with all fields', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { success: true } }
      });

      const result = await adapter.updateTransaction('123', {
        description: 'Updated desc',
        tags: ['Food', 'Groceries'],
        memo: 'Weekly shopping'
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('transaction_edit'),
        expect.objectContaining({
          id: '123',
          description: 'Updated desc',
          tags: 'Food,Groceries',
          memo: 'Weekly shopping'
        })
      );
    });
  });

  describe('addTransaction', () => {
    beforeEach(() => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    test('adds new transaction', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { transactionId: 456 } }
      });

      const result = await adapter.addTransaction({
        accountId: '123',
        amount: 50.00,
        date: '2026-01-15',
        description: 'Coffee',
        tags: ['Food'],
        type: 'expense'
      });

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('transaction_add'),
        expect.objectContaining({
          accountId: '123',
          amount: 50.00,
          description: 'Coffee'
        })
      );
    });
  });

  describe('deleteTransaction', () => {
    beforeEach(() => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;
    });

    test('deletes transaction', async () => {
      mockHttpClient.post.mockResolvedValue({
        data: { response: { success: true } }
      });

      await adapter.deleteTransaction('123');

      expect(mockHttpClient.post).toHaveBeenCalledWith(
        expect.stringContaining('transaction_delete'),
        { id: '123' }
      );
    });
  });

  describe('mapToTransaction', () => {
    test('maps raw Buxfer data to Transaction entity', () => {
      const raw = {
        id: 123,
        date: '2026-01-15',
        amount: -75.50,
        description: 'Grocery Store',
        tagNames: ['Food', 'Groceries'],
        accountId: 456,
        type: 'expense',
        memo: 'Weekly shopping'
      };

      const transaction = adapter.mapToTransaction(raw);

      expect(transaction.id).toBe('123');
      expect(transaction.date).toBe('2026-01-15');
      expect(transaction.amount).toBe(75.50);
      expect(transaction.description).toBe('Grocery Store');
      expect(transaction.category).toBe('Food');
      expect(transaction.type).toBe('expense');
      expect(transaction.tags).toEqual(['Food', 'Groceries']);
    });

    test('infers income type from positive amount', () => {
      const raw = {
        id: 123,
        date: '2026-01-15',
        amount: 1500,
        description: 'Paycheck',
        tagNames: ['Income']
      };

      const transaction = adapter.mapToTransaction(raw);

      expect(transaction.type).toBe('income');
    });

    test('handles transfer type', () => {
      const raw = {
        id: 123,
        date: '2026-01-15',
        amount: 500,
        description: 'Transfer to Savings',
        type: 'transfer'
      };

      const transaction = adapter.mapToTransaction(raw);

      expect(transaction.type).toBe('transfer');
    });
  });

  describe('mapAccountType', () => {
    test('maps Buxfer account types to domain types', () => {
      expect(adapter.mapAccountType('checking')).toBe('checking');
      expect(adapter.mapAccountType('savings')).toBe('savings');
      expect(adapter.mapAccountType('credit card')).toBe('credit');
      expect(adapter.mapAccountType('investment')).toBe('investment');
      expect(adapter.mapAccountType('loan')).toBe('loan');
      expect(adapter.mapAccountType('cash')).toBe('checking');
      expect(adapter.mapAccountType('unknown')).toBe('checking');
    });
  });

  describe('getMetrics', () => {
    test('returns metrics data', async () => {
      adapter.token = 'test-token';
      adapter.tokenExpiresAt = Date.now() + 3600000;

      mockHttpClient.get.mockResolvedValue({ data: { response: {} } });
      await adapter.request('accounts');

      const metrics = adapter.getMetrics();

      expect(metrics.uptime.ms).toBeGreaterThanOrEqual(0);
      expect(metrics.totals.requests).toBeGreaterThan(0);
      expect(metrics.authenticated).toBe(true);
      expect(metrics.tokenExpiresAt).toBeDefined();
    });
  });

  describe('isConfigured', () => {
    test('returns true when credentials exist', () => {
      expect(adapter.isConfigured()).toBe(true);
    });

    test('returns false when credentials missing', () => {
      mockGetCredentials.mockReturnValue({});
      expect(adapter.isConfigured()).toBe(false);
    });
  });

  describe('helper methods', () => {
    test('getDefaultStartDate returns date 1 year ago', () => {
      const result = adapter.getDefaultStartDate();
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      expect(result).toBe(oneYearAgo.toISOString().split('T')[0]);
    });

    test('getDefaultEndDate returns today', () => {
      const result = adapter.getDefaultEndDate();
      const today = new Date().toISOString().split('T')[0];

      expect(result).toBe(today);
    });

    test('formatDuration formats milliseconds', () => {
      expect(adapter.formatDuration(3661000)).toBe('1h 1m 1s');
      expect(adapter.formatDuration(0)).toBe('0h 0m 0s');
    });
  });
});
