/**
 * Finance Categorization Integration Test
 *
 * Tests that the TransactionCategorizationService properly identifies
 * and processes untagged transactions using AI.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { TransactionCategorizationService } from '#backend/src/3_applications/finance/TransactionCategorizationService.mjs';

describe('FinanceCategorization', () => {
  let service;
  let mockAIGateway;
  let mockTransactionSource;
  let mockFinanceStore;
  let mockLogger;

  // Real-world categorization config matching production gpt.yml
  const realCategorizationConfig = {
    validTags: [
      'Allowance', 'Car', 'Car Maintenance', 'Charity', 'Childcare', 'Clothing',
      'Convenience Store', 'Credit Card Payment', 'Dental', 'Depreciation',
      'Dividend', 'Donations', 'Family', 'Fast Offering', 'Fees', 'Food & Dining',
      'Fuel', 'Fun', 'Gifts', 'Groceries', 'Health & Wellness', 'Home Maintenance',
      'Housewares', 'Housing', 'Income', 'Insurance', 'Interest', 'Investments',
      'Learning & Leisure', 'Media', 'Medical', 'Outsourcing', 'Payroll',
      'Personal Care', 'Pharmacy', 'Reimbursement', 'Rental Income', 'Restaurants',
      'Savings', 'Shipping', 'Shopping', 'Software', 'Subscriptions', 'Supplies',
      'Tax', 'Taxes', 'Tithing', 'Transfer', 'Transportation', 'Travel', 'Utilities'
    ],
    chat: [
      {
        role: 'system',
        content: 'You are financial transactions processor. Categorize into: __VALID_TAGS__'
      }
    ]
  };

  // Sample untagged transactions matching real production data
  const untaggedTransactions = [
    { id: '235351917', date: '2026-02-02', description: 'Mortgage', tagNames: [], amount: 6206.97 },
    { id: '235317090', date: '2026-02-02', description: 'Harman Internationa', tagNames: [], amount: 27.94 },
    { id: '235000001', date: '2026-01-15', description: 'Quick Quack Car Wash', tagNames: [], amount: 15.00 },
    { id: '235000002', date: '2026-01-15', description: 'Chevron', tagNames: [], amount: 45.00 },
    { id: '235000003', date: '2026-01-15', description: '7-Eleven', tagNames: [], amount: 12.50 },
    { id: '235000004', date: '2026-01-15', description: 'Google*Cloud Kqfpt8', tagNames: [], amount: 25.00 },
    { id: '235000005', date: '2026-01-15', description: 'Shell', tagNames: [], amount: 55.00 },
    { id: '235000006', date: '2026-01-15', description: 'Walmart', tagNames: [], amount: 85.00 },
    { id: '235000007', date: '2026-01-15', description: 'Fred Meyer', tagNames: [], amount: 120.00 },
  ];

  beforeEach(() => {
    mockAIGateway = {
      chatWithJson: jest.fn()
    };

    mockTransactionSource = {
      updateTransaction: jest.fn().mockResolvedValue({ success: true })
    };

    mockFinanceStore = {
      getCategorizationConfig: jest.fn().mockReturnValue(realCategorizationConfig)
    };

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    };

    service = new TransactionCategorizationService({
      aiGateway: mockAIGateway,
      transactionSource: mockTransactionSource,
      financeStore: mockFinanceStore,
      logger: mockLogger
    });
  });

  describe('identifies untagged transactions', () => {
    it('flags transactions with empty tagNames array', () => {
      const result = service.getUncategorized(untaggedTransactions);

      // All 9 transactions should need categorization (empty tags)
      expect(result).toHaveLength(9);
      expect(result.map(t => t.id)).toContain('235351917');
    });

    it('ignores transactions that already have tags', () => {
      const mixedTransactions = [
        { id: '1', description: 'Tagged one', tagNames: ['Groceries'] },
        { id: '2', description: 'Untagged', tagNames: [] },
      ];

      const result = service.getUncategorized(mixedTransactions);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('2');
    });
  });

  describe('categorizes transaction 235351917 (Mortgage)', () => {
    it('sends Mortgage description to AI and gets Housing category', async () => {
      const mortgageTransaction = [
        { id: '235351917', date: '2026-02-02', description: 'Mortgage', tagNames: [], amount: 6206.97 }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'Housing',
        friendlyName: 'Mortgage Payment',
        memo: 'Monthly mortgage'
      });

      const result = await service.categorize(mortgageTransaction);

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(1);
      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].id).toBe('235351917');
      expect(result.processed[0].category).toBe('Housing');
      expect(result.processed[0].friendlyName).toBe('Mortgage Payment');

      // Verify update was called
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith(
        '235351917',
        {
          description: 'Mortgage Payment',
          tags: 'Housing',
          memo: 'Monthly mortgage'
        }
      );
    });
  });

  describe('categorizes common transaction types', () => {
    const testCases = [
      { desc: 'Chevron', expectedCategory: 'Fuel', expectedName: 'Chevron' },
      { desc: 'Shell', expectedCategory: 'Fuel', expectedName: 'Shell' },
      { desc: 'Quick Quack Car Wash', expectedCategory: 'Car Maintenance', expectedName: 'Quick Quack' },
      { desc: '7-Eleven', expectedCategory: 'Convenience Store', expectedName: '7-Eleven' },
      { desc: 'Google*Cloud Kqfpt8', expectedCategory: 'Software', expectedName: 'Google Cloud' },
      { desc: 'Walmart', expectedCategory: 'Groceries', expectedName: 'Walmart' },
      { desc: 'Fred Meyer', expectedCategory: 'Groceries', expectedName: 'Fred Meyer' },
    ];

    testCases.forEach(({ desc, expectedCategory, expectedName }) => {
      it(`categorizes "${desc}" as ${expectedCategory}`, async () => {
        const transactions = [
          { id: 'test-1', date: '2026-01-15', description: desc, tagNames: [] }
        ];

        mockAIGateway.chatWithJson.mockResolvedValue({
          category: expectedCategory,
          friendlyName: expectedName
        });

        const result = await service.categorize(transactions);

        expect(result.processed).toHaveLength(1);
        expect(result.processed[0].category).toBe(expectedCategory);
        expect(realCategorizationConfig.validTags).toContain(expectedCategory);
      });
    });
  });

  describe('validates categories against config', () => {
    it('rejects invalid category from AI', async () => {
      const transactions = [
        { id: '1', date: '2026-01-15', description: 'Test', tagNames: [] }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'NotAValidCategory',
        friendlyName: 'Test'
      });

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('Invalid category');
    });

    it('accepts all valid categories from production config', () => {
      // Verify all 50+ categories are in the config
      expect(realCategorizationConfig.validTags.length).toBeGreaterThan(45);
      expect(realCategorizationConfig.validTags).toContain('Housing');
      expect(realCategorizationConfig.validTags).toContain('Fuel');
      expect(realCategorizationConfig.validTags).toContain('Groceries');
      expect(realCategorizationConfig.validTags).toContain('Software');
    });
  });

  describe('handles batch processing', () => {
    it('processes multiple untagged transactions', async () => {
      // Mock AI to return appropriate categories
      mockAIGateway.chatWithJson
        .mockResolvedValueOnce({ category: 'Housing', friendlyName: 'Mortgage' })
        .mockResolvedValueOnce({ category: 'Shopping', friendlyName: 'Harman' })
        .mockResolvedValueOnce({ category: 'Car Maintenance', friendlyName: 'Quick Quack' });

      const result = await service.categorize(untaggedTransactions.slice(0, 3));

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(3);
      expect(result.processed).toHaveLength(3);
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledTimes(3);
    });

    it('continues processing after individual failures', async () => {
      // Use simple transactions without raw description patterns
      const simpleTransactions = [
        { id: '1', date: '2026-01-15', description: 'Transaction One', tagNames: [] },
        { id: '2', date: '2026-01-15', description: 'Transaction Two', tagNames: [] },
        { id: '3', date: '2026-01-15', description: 'Transaction Three', tagNames: [] },
      ];

      mockAIGateway.chatWithJson
        .mockResolvedValueOnce({ category: 'Housing', friendlyName: 'Trans One' })
        .mockRejectedValueOnce(new Error('API timeout'))
        .mockResolvedValueOnce({ category: 'Fuel', friendlyName: 'Trans Three' });

      const result = await service.categorize(simpleTransactions);

      expect(result.processed).toHaveLength(2);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('API timeout');
    });
  });
});
