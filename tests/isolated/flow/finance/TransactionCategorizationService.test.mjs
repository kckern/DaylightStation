/**
 * TransactionCategorizationService Tests
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { TransactionCategorizationService } from '#backend/src/3_applications/finance/TransactionCategorizationService.mjs';

describe('TransactionCategorizationService', () => {
  let service;
  let mockAIGateway;
  let mockTransactionSource;
  let mockFinanceStore;
  let mockLogger;

  const mockCategorizationConfig = {
    validTags: ['Groceries', 'Gas', 'Dining', 'Shopping', 'Transfer', 'Income'],
    chat: [
      {
        role: 'system',
        content: 'You are a transaction categorizer. Valid tags: __VALID_TAGS__'
      }
    ]
  };

  beforeEach(() => {
    mockAIGateway = {
      chatWithJson: jest.fn()
    };

    mockTransactionSource = {
      updateTransaction: jest.fn().mockResolvedValue({ success: true })
    };

    mockFinanceStore = {
      getCategorizationConfig: jest.fn().mockReturnValue(mockCategorizationConfig)
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

  describe('constructor', () => {
    it('throws if aiGateway is missing', () => {
      expect(() => new TransactionCategorizationService({
        transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore
      })).toThrow('requires aiGateway');
    });

    it('throws if transactionSource is missing', () => {
      expect(() => new TransactionCategorizationService({
        aiGateway: mockAIGateway,
        financeStore: mockFinanceStore
      })).toThrow('requires transactionSource');
    });

    it('throws if financeStore is missing', () => {
      expect(() => new TransactionCategorizationService({
        aiGateway: mockAIGateway,
        transactionSource: mockTransactionSource
      })).toThrow('requires financeStore');
    });
  });

  describe('categorize', () => {
    it('skips transactions that already have tags and clean descriptions', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'Clean description', tagNames: ['Groceries'] },
        { id: '2', date: '2026-01-02', description: 'Another clean one', tagNames: ['Gas'] }
      ];

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(result.skipped).toHaveLength(2);
      expect(mockAIGateway.chatWithJson).not.toHaveBeenCalled();
    });

    it('processes transactions with no tags', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'WALMART #1234', tagNames: [] }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'Groceries',
        friendlyName: 'Walmart',
        memo: 'Weekly shopping'
      });

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].category).toBe('Groceries');
      expect(result.processed[0].friendlyName).toBe('Walmart');
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith(
        '1',
        'Walmart',
        'Groceries',
        'Weekly shopping'
      );
    });

    it('processes transactions with raw descriptions', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'Direct Deposit PWP*12345', tagNames: ['Income'] }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'Income',
        friendlyName: 'Paycheck'
      });

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(1);
      expect(result.processed[0].friendlyName).toBe('Paycheck');
    });

    it('handles invalid category from AI', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'Some transaction', tagNames: [] }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'InvalidCategory',
        friendlyName: 'Some Name'
      });

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('Invalid category');
    });

    it('handles AI errors gracefully', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'Some transaction', tagNames: [] }
      ];

      mockAIGateway.chatWithJson.mockRejectedValue(new Error('API timeout'));

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toContain('API timeout');
    });

    it('returns empty results when config is missing', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue(null);

      const transactions = [
        { id: '1', date: '2026-01-01', description: 'Test', tagNames: [] }
      ];

      const result = await service.categorize(transactions);

      expect(result.processed).toHaveLength(0);
      expect(result.skipped).toEqual(transactions);
    });
  });

  describe('preview', () => {
    it('returns suggestions without updating external system', async () => {
      const transactions = [
        { id: '1', date: '2026-01-01', description: 'COSTCO #567', tagNames: [] }
      ];

      mockAIGateway.chatWithJson.mockResolvedValue({
        category: 'Groceries',
        friendlyName: 'Costco',
        memo: 'Bulk shopping'
      });

      const result = await service.preview(transactions);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].suggestedCategory).toBe('Groceries');
      expect(result.suggestions[0].suggestedName).toBe('Costco');
      expect(mockTransactionSource.updateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getUncategorized', () => {
    it('returns transactions needing categorization', () => {
      const transactions = [
        { id: '1', description: 'Clean one', tagNames: ['Gas'] },
        { id: '2', description: 'No tags', tagNames: [] },
        { id: '3', description: 'Direct Deposit raw', tagNames: ['Income'] },
        { id: '4', description: 'Another clean', tagNames: ['Dining'] }
      ];

      const result = service.getUncategorized(transactions);

      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toEqual(['2', '3']);
    });
  });

  describe('addRawDescriptionPatterns', () => {
    it('adds custom patterns for detection', () => {
      service.addRawDescriptionPatterns([/CUSTOM_PATTERN/i]);

      const transactions = [
        { id: '1', description: 'CUSTOM_PATTERN_123', tagNames: ['Shopping'] }
      ];

      const result = service.getUncategorized(transactions);
      expect(result).toHaveLength(1);
    });
  });
});
