import { describe, it, expect, vi } from 'vitest';
import { TransactionCategoryJudge } from './TransactionCategoryJudge.mjs';

const TAGS = ['Groceries', 'Fuel', 'Income', 'Payroll', 'Shopping'];
const txn = {
  id: 7, description: 'Sq *6 Saplings Sugarhouse', type: 'expense', amount: -42.5,
  accountName: 'Visa', date: '2026-09-20', tagNames: [],
};
const gatewayAnswering = (answer) => ({
  isConfigured: () => true,
  evaluate: vi.fn().mockResolvedValue({ model: 'jev-test-1', answers: { category: answer }, usage: {} }),
});
const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });

describe('TransactionCategoryJudge', () => {
  it('asks one choice over validTags with the transaction facts as state', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Groceries', confidence: 0.91, probabilities: { Groceries: 0.91 } });
    const verdict = await new TransactionCategoryJudge({ decisionGateway: gateway, logger: makeLogger() }).judge(txn, TAGS);

    const [state, questions, options] = gateway.evaluate.mock.calls[0];
    expect(state).toEqual({ description: 'Sq *6 Saplings Sugarhouse', type: 'expense', amount: 42.5, account: 'Visa', date: '2026-09-20' });
    expect(questions.category.type).toBe('choice');
    expect(Object.keys(questions.category.options)).toEqual(TAGS);
    expect(options).toEqual({ timeout: 5000 });
    expect(verdict).toMatchObject({ category: 'Groceries', confidence: 0.91, model: 'jev-test-1', cjk: false });
    expect(verdict.ms).toBeGreaterThanOrEqual(0);
  });

  it('returns null when no decision model is configured', async () => {
    expect(await new TransactionCategoryJudge().judge(txn, TAGS)).toBeNull();
    const noop = { isConfigured: () => false, evaluate: vi.fn() };
    expect(await new TransactionCategoryJudge({ decisionGateway: noop }).judge(txn, TAGS)).toBeNull();
    expect(noop.evaluate).not.toHaveBeenCalled();
  });

  it('returns null with fewer than two distinct tags', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Fuel', confidence: 1, probabilities: {} });
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway }).judge(txn, ['Fuel', 'Fuel'])).toBeNull();
    expect(gateway.evaluate).not.toHaveBeenCalled();
  });

  it('never throws: a failed evaluate is logged and returns null', async () => {
    const logger = makeLogger();
    const gateway = { isConfigured: () => true, evaluate: vi.fn().mockRejectedValue(new Error('timeout')) };
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway, logger }).judge(txn, TAGS)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('categorization.jev.failed', expect.objectContaining({ id: 7, error: 'timeout' }));
  });

  it('drops a choice outside validTags but keeps its confidence', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Car Rental', confidence: 0.6, probabilities: {} });
    expect(await new TransactionCategoryJudge({ decisionGateway: gateway }).judge(txn, TAGS))
      .toMatchObject({ category: null, confidence: 0.6 });
  });

  it('flags CJK descriptions so agreement can be sliced by script', async () => {
    const gateway = gatewayAnswering({ type: 'choice', choice: 'Shopping', confidence: 0.7, probabilities: {} });
    const verdict = await new TransactionCategoryJudge({ decisionGateway: gateway }).judge({ ...txn, description: '롯데쇼핑（주）' }, TAGS);
    expect(verdict.cjk).toBe(true);
  });
});
