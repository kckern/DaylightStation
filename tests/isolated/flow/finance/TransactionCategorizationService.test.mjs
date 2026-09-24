/**
 * TransactionCategorizationService Tests
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TransactionCategorizationService } from '#backend/src/3_applications/finance/TransactionCategorizationService.mjs';
import { TransactionCategoryJudge } from '#backend/src/3_applications/finance/TransactionCategoryJudge.mjs';

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

    it('previews a rule-tagged transaction once, without asking the LLM (as apply does)', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({
        ...mockCategorizationConfig, descriptionRules: [{ pattern: 'CASH SWEEP', rename: 'Cash Sweep', tag: 'Transfer' }],
      });
      const transactions = [{ id: '1', date: '2026-01-01', description: 'FIDELITY CASH SWEEP Xx1234', tagNames: [] }];

      const result = await service.preview(transactions);

      expect(result.suggestions).toEqual([expect.objectContaining({ id: '1', source: 'rule', suggestedName: 'Cash Sweep', suggestedCategory: 'Transfer' })]);
      expect(mockAIGateway.chatWithJson).not.toHaveBeenCalled();
      expect(transactions[0].description).toBe('FIDELITY CASH SWEEP Xx1234');
    });

    it('a rule without a tag sends the renamed description to the LLM, as apply does', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({
        ...mockCategorizationConfig, descriptionRules: [{ pattern: 'ACME', rename: 'Acme' }],
      });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Shopping', friendlyName: 'Acme' });

      const result = await service.preview([{ id: '1', date: '2026-01-01', description: 'ACME STORE 42', tagNames: [] }]);

      const messages = mockAIGateway.chatWithJson.mock.calls[0][0];
      expect(messages.at(-1)).toEqual({ role: 'user', content: 'Acme' });
      expect(result.suggestions.map(s => s.source ?? 'llm')).toEqual(['rule', 'llm']);
    });

    it('skips a settled row exactly as categorize does', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Income', friendlyName: 'Direct Deposit' });
      await service.categorize([{ id: 9, date: '2026-09-15', description: 'Direct Deposit Acme Payroll Ppd', tagNames: [] }]);
      mockAIGateway.chatWithJson.mockClear();

      const result = await service.preview([{ id: 9, date: '2026-09-15', description: 'Direct Deposit', tagNames: ['Income'] }]);

      expect(mockAIGateway.chatWithJson).not.toHaveBeenCalled();
      expect(result).toEqual({ suggestions: [], failed: [] });
    });

    it('asks the LLM about the same rows, with the same descriptions, as categorize', async () => {
      const config = {
        ...mockCategorizationConfig,
        descriptionRules: [{ pattern: 'CASH SWEEP', rename: 'Cash Sweep', tag: 'Transfer' }, { pattern: 'ACME', rename: 'Acme' }],
      };
      mockFinanceStore.getCategorizationConfig.mockReturnValue(config);
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Shopping', friendlyName: 'Named' });
      const rows = () => [
        { id: '1', date: '2026-01-01', description: 'FIDELITY CASH SWEEP Xx1234', tagNames: [] },
        { id: '2', date: '2026-01-01', description: 'ACME STORE 42', tagNames: [] },
        { id: '3', date: '2026-01-01', description: 'Clean Row', tagNames: ['Dining'] },
        { id: '4', date: '2026-01-01', description: 'SQ *COFFEE', tagNames: ['Dining'] },
      ];
      const asked = () => mockAIGateway.chatWithJson.mock.calls.map(([messages]) => messages.at(-1).content);

      await service.preview(rows());
      const previewAsked = asked();
      mockAIGateway.chatWithJson.mockClear();
      await service.categorize(rows());

      expect(previewAsked).toEqual(['Acme', 'SQ *COFFEE']);
      expect(asked()).toEqual(previewAsked);
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
    const warnings = (name) => mockLogger.warn.mock.calls
      .filter(([event]) => event === name).map(([, data]) => data);
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
      expect(compareLogs()).toEqual([]);
    });

    it('a judge that rejects outright leaves the legacy result untouched', async () => {
      const spy = vi.spyOn(TransactionCategoryJudge.prototype, 'judge').mockRejectedValue(new Error('judge blew up'));
      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });

        const result = await service.categorize(walmart());
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(spy).toHaveBeenCalledTimes(1);
        expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
        expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Groceries', memo: null });
        expect(compareLogs()).toEqual([]);
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
        spy.mockRestore();
      }
    });

    it('a rejecting judge does not leak when the LLM also fails', async () => {
      const spy = vi.spyOn(TransactionCategoryJudge.prototype, 'judge').mockRejectedValue(new Error('judge blew up'));
      try {
        mockAIGateway.chatWithJson.mockRejectedValue(new Error('API timeout'));

        const result = await service.preview(walmart());

        expect(result.failed[0].reason).toBe('AI error: API timeout');
        expect(compareLogs()).toEqual([]);
      } finally {
        spy.mockRestore();
      }
    });

    it('defaults to mode shadow and floor 0.8 when the config has no jev block', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.9);

      await service.categorize(walmart());

      expect(compareLogs()).toEqual([expect.objectContaining({ mode: 'shadow', floor: 0.8 })]);
      expect(warnings('categorization.jev.policy.invalid')).toEqual([]);
    });

    it('flags an LLM error in the comparison', async () => {
      mockAIGateway.chatWithJson.mockRejectedValue(new Error('API timeout'));
      jevSays('Groceries', 0.9);

      await service.categorize(walmart());

      expect(compareLogs()).toEqual([expect.objectContaining({ llmError: true, llmCategory: null, via: null })]);
    });

    it('marks llmError false when the LLM answered', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
      jevSays('Shopping', 0.9);

      await service.categorize(walmart());

      expect(compareLogs()).toEqual([expect.objectContaining({ llmError: false, llmValid: false })]);
    });

    it('an unknown mode falls back to shadow and warns once per distinct bad config', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'yolo' } });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.9);

      await service.categorize(walmart());
      await service.categorize(walmart());

      expect(compareLogs().map((c) => c.mode)).toEqual(['shadow', 'shadow']);
      expect(warnings('categorization.jev.policy.invalid')).toEqual([expect.objectContaining({ mode: 'yolo' })]);
    });

    it.each([[1.5], [-0.1], [Number.NaN], ['0.9']])('confidenceFloor %s falls back to 0.8 and warns once', async (floor) => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'shadow', confidenceFloor: floor } });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.9);

      await service.categorize(walmart());
      await service.preview(walmart());

      expect(compareLogs().map((c) => c.floor)).toEqual([0.8, 0.8]);
      expect(warnings('categorization.jev.policy.invalid')).toHaveLength(1);
    });

    it('warns again for a different bad config', async () => {
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.9);

      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'yolo' } });
      await service.categorize(walmart());
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { confidenceFloor: 2 } });
      await service.categorize(walmart());

      expect(warnings('categorization.jev.policy.invalid')).toHaveLength(2);
    });

    it('a valid floor inside [0,1] is used as given', async () => {
      mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 0.65 } });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
      jevSays('Groceries', 0.9);

      await service.categorize(walmart());

      expect(compareLogs()).toEqual([expect.objectContaining({ mode: 'promote', floor: 0.65 })]);
      expect(warnings('categorization.jev.policy.invalid')).toEqual([]);
    });

    it('a service built without decisionGateway emits no comparison', async () => {
      service = new TransactionCategorizationService({
        aiGateway: mockAIGateway, transactionSource: mockTransactionSource,
        financeStore: mockFinanceStore, logger: mockLogger,
      });
      mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });

      const result = await service.categorize(walmart());

      expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      expect(compareLogs()).toEqual([]);
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

    describe('promote mode', () => {
      beforeEach(() => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({
          ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 0.8 },
        });
      });

      it('Jev category wins at the floor; the LLM still names and memos', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart', memo: 'Weekly' });
        jevSays('Shopping', 0.8);

        const result = await service.categorize(walmart());

        expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Shopping', memo: 'Weekly' });
        expect(result.processed[0]).toMatchObject({ category: 'Shopping', categoryVia: 'jev' });
        expect(compareLogs()).toEqual([expect.objectContaining({ mode: 'promote', via: 'jev', agreed: false })]);
      });

      it('below the floor the LLM category stands', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.79);

        const result = await service.categorize(walmart());

        expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
      });

      it('rescues a blank LLM category when Jev is confident', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
        jevSays('Shopping', 0.9);

        const result = await service.categorize(walmart());

        expect(result.failed).toEqual([]);
        expect(result.processed[0]).toMatchObject({ friendlyName: 'PayPal', category: 'Shopping', categoryVia: 'jev' });
      });

      it('cannot rescue a missing friendly name', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Shopping' });
        jevSays('Shopping', 0.99);

        const result = await service.categorize(walmart());

        expect(result.failed[0].reason).toBe('AI did not provide a friendly name');
      });

      it('preview promotes exactly as apply does', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.9);

        const result = await service.preview(walmart());

        expect(result.suggestions[0]).toMatchObject({ suggestedCategory: 'Shopping', categoryVia: 'jev' });
      });

      it('an invalid confidenceFloor falls back to 0.8', async () => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 'high' } });
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.75);

        const result = await service.categorize(walmart());

        expect(result.processed[0].categoryVia).toBe('llm');
        expect(compareLogs()[0].floor).toBe(0.8);
      });

      it('a null confidence never promotes, even at floor 0', async () => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'promote', confidenceFloor: 0 } });
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        decisionGateway.evaluate.mockResolvedValue({
          model: 'jev-test-1', usage: {}, answers: { category: { type: 'choice', choice: 'Shopping', confidence: null } },
        });

        const result = await service.categorize(walmart());

        expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
        expect(compareLogs()).toEqual([expect.objectContaining({ via: 'llm' })]);
      });

      it('a Jev pick outside validTags never promotes', async () => {
        mockAIGateway.chatWithJson.mockResolvedValue({ category: '', friendlyName: 'PayPal' });
        jevSays('Bogus', 0.99);

        const result = await service.categorize(walmart());

        expect(result.processed).toEqual([]);
        expect(result.failed[0].reason).toBe('Invalid category: ');
        expect(mockTransactionSource.updateTransaction).not.toHaveBeenCalled();
      });

      it('an LLM error is not rescued by Jev', async () => {
        mockAIGateway.chatWithJson.mockRejectedValue(new Error('API timeout'));
        jevSays('Shopping', 0.99);

        const result = await service.categorize(walmart());

        expect(result.failed[0].reason).toBe('AI error: API timeout');
        expect(mockTransactionSource.updateTransaction).not.toHaveBeenCalled();
      });

      it('shadow mode with a confident Jev still applies the LLM category', async () => {
        mockFinanceStore.getCategorizationConfig.mockReturnValue({ ...mockCategorizationConfig, jev: { mode: 'shadow', confidenceFloor: 0.8 } });
        mockAIGateway.chatWithJson.mockResolvedValue({ category: 'Groceries', friendlyName: 'Walmart' });
        jevSays('Shopping', 0.99);

        const result = await service.categorize(walmart());

        expect(result.processed[0]).toMatchObject({ category: 'Groceries', categoryVia: 'llm' });
        expect(mockTransactionSource.updateTransaction).toHaveBeenCalledWith('1', { description: 'Walmart', tags: 'Groceries', memo: null });
      });
    });
  });
});
