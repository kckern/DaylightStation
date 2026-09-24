/**
 * TransactionCategorizationService Tests
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
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
      chatWithJson: vi.fn()
    };

    mockTransactionSource = {
      updateTransaction: vi.fn().mockResolvedValue({ success: true })
    };

    mockFinanceStore = {
      getCategorizationConfig: vi.fn().mockReturnValue(mockCategorizationConfig)
    };

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
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
        {
          description: 'Walmart',
          tags: 'Groceries',
          memo: 'Weekly shopping'
        }
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

  describe('settled transactions', () => {
    it('does not re-send a tagged transaction whose new name still matches a raw pattern', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);

      // The next harvest re-reads the renamed, tagged transaction from the provider
      const result = await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit', tagNames: ['Income'] }]);

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(1);
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledTimes(1);
      expect(result.skipped).toHaveLength(1);
      expect(mockLogger.info).toHaveBeenCalledWith('categorization.settled', { id: 9, friendlyName: 'Direct Deposit' });
    });

    it('re-sends it when the provider description changes again', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Pwp Xx12', tagNames: ['Income'] }]);

      expect(mockAIGateway.chatWithJson).toHaveBeenCalledTimes(2);
    });

    it('getUncategorized agrees with categorize about settled rows', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);

      expect(service.getUncategorized([{ id: '9', description: 'Direct Deposit', tagNames: ['Income'] }])).toEqual([]);
    });
  });

  describe('Jev category shadow', () => {
    let decisionGateway;
    const jevSays = (category, confidence) => decisionGateway.evaluate.mockResolvedValue({
      model: 'jev-test-1', usage: {},
      answers: { category: { type: 'choice', choice: category, confidence, probabilities: { [category]: confidence } } },
    });
    const compareLogs = () => mockLogger.info.mock.calls
      .filter(([event]) => event === 'categorization.jev.compare').map(([, data]) => data);
    const walmart = () => [{ id: '1', date: '2026-01-01', description: 'WALMART #1234', tagNames: [] }];

    beforeEach(() => {
      decisionGateway = { isConfigured: () => true, evaluate: vi.fn() };
      service = new TransactionCategorizationService({
        aiGateway: mockAIGateway, transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore, decisionGateway, logger: mockLogger,
      });
    });

    it('logs both picks and keeps the LLM category on the apply path', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Shopping', 0.95);

      const result = await service.categorize(walmart());

      expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Groceries', memo: null });
      expect(compareLogs()).toEqual([expect.objectContaining({
        id: '1', path: 'apply', mode: 'shadow', llmCategory: 'Groceries', llmValid: true,
        jevCategory: 'Shopping', confidence: 0.95, agreed: false, via: 'llm', model: 'jev-test-1', cjk: false,
      })]);
    });

    it('logs the same comparison on the preview path and writes nothing', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.7);

      const result = await service.preview(walmart());

      expect(result.suggestions[0]).toMatchObject({ suggestedCategory: 'Groceries', categoryVia: 'llm' });
      expect(mockTransactionSource.updateTransaction).not.toHaveBeenCalled();
      expect(compareLogs()).toEqual([expect.objectContaining({ path: 'preview', agreed: true, confidence: 0.7 })]);
    });

    it('still compares when the LLM category is invalid, and the row still fails in shadow', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
      jevSays('Shopping', 0.9);

      const result = await service.categorize(walmart());

      expect(result.failed[0].reason).toBe('Invalid category: ');
      expect(compareLogs()).toEqual([expect.objectContaining({ llmCategory: '', llmValid: false, jevCategory: 'Shopping', agreed: false, via: null })]);
    });

    it('a Jev failure leaves the legacy result untouched', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      decisionGateway.evaluate.mockRejectedValue(new Error('jev down'));

      const result = await service.categorize(walmart());

      expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      expect(compareLogs()).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalledWith('categorization.jev.failed', expect.objectContaining({ error: 'jev down' }));
    });

    it('mode off asks Jev nothing', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'off' } });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });

      await service.categorize(walmart());

      expect(decisionGateway.evaluate).not.toHaveBeenCalled();
    });

    it('asks Jev while the LLM is still thinking', async () => {
      let releaseLlm;
      mockAIGateway.chatWithJson.mockReturnValue(new Promise((resolve) => { releaseLlm = resolve; }));
      jevSays('Groceries', 0.9);

      const pending = service.categorize(walmart());
      await vi.waitFor(() => expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1));
      releaseLlm({ category: 'Groceries', friendlyName: 'Walmart' });

      expect((await pending).processed).toHaveLength(1);
    });
  });
});
