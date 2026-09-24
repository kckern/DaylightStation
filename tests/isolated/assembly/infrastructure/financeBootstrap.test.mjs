import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFinanceServices } from '#composition/bootstrap.mjs';

describe('createFinanceServices: categorization decision gateway', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finance-wiring-'));
    fs.writeFileSync(path.join(dir, 'gpt.yml'),
      'validTags: [Groceries, Shopping]\nchat:\n  - role: system\n    content: "Tags: __VALID_TAGS__"\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes the decision gateway into the categorization service', async () => {
    const decisionGateway = {
      isConfigured: () => true,
      evaluate: vi.fn().mockResolvedValue({
        model: 'jev-test-1', usage: {},
        answers: { category: { type: 'choice', choice: 'Groceries', confidence: 0.9, probabilities: {} } },
      }),
    };
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const { categorizationService } = createFinanceServices({
      configService: { getHouseholdPath: () => dir },
      buxferAdapter: { updateTransaction: vi.fn() },
      aiGateway: { chatWithJson: vi.fn().mockResolvedValue({ category: 'Groceries', friendlyName: 'Costco' }) },
      decisionGateway,
      defaultHouseholdId: 'default',
      logger,
    });

    await categorizationService.preview([{ id: '1', date: '2026-01-01', description: 'COSTCO #567', tagNames: [] }], 'default');

    expect(decisionGateway.evaluate).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith('finance.categorization.enabled', { validTags: 2, jev: true });
  });

  it.each([
    ['no decision gateway', null],
    ['an unconfigured decision gateway', { isConfigured: () => false, evaluate: vi.fn() }],
  ])('with %s, categorization runs as before and reports jev: false', async (_label, decisionGateway) => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const { categorizationService } = createFinanceServices({
      configService: { getHouseholdPath: () => dir },
      buxferAdapter: { updateTransaction: vi.fn() },
      aiGateway: { chatWithJson: vi.fn().mockResolvedValue({ category: 'Groceries', friendlyName: 'Costco' }) },
      decisionGateway,
      defaultHouseholdId: 'default',
      logger,
    });

    const result = await categorizationService.preview([{ id: '1', date: '2026-01-01', description: 'COSTCO #567', tagNames: [] }], 'default');

    expect(result.suggestions[0]).toMatchObject({ suggestedCategory: 'Groceries', categoryVia: 'llm' });
    expect(decisionGateway?.evaluate ?? vi.fn()).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith('finance.categorization.enabled', { validTags: 2, jev: false });
    expect(logger.info.mock.calls.filter(([event]) => event === 'categorization.jev.compare')).toEqual([]);
  });
});
