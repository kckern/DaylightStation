import { describe, expect, it, vi } from 'vitest';
import { DayToDayRebalanceService } from "./DayToDayRebalanceService.mjs";

const rule = { dayTag: 'Shopping', swingTag: 'Housewares', payees: ['Amazon'] };

// 30-day November, $3000 budget → burn-down drops $100/day.
function november(spend, transactions = []) {
  const dailyBalances = { '2026-11-start': { startingBalance: 3000 } };
  let bal = 3000;
  for (let d = 1; d <= 30; d++) {
    bal -= spend[d] || 0;
    dailyBalances[`2026-11-${String(d).padStart(2, '0')}`] = { endingBalance: bal };
  }
  return { budget: 3000, dailyBalances, transactions };
}

const txn = (id, date, amount, description, tagNames) => ({ id, date, amount, expenseAmount: amount, description, tagNames, tags: tagNames.join(',') });

function setup({ monthData, shortTermBuckets = {}, periodRule = rule, updateTransaction } = {}) {
  const stored = [
    txn(1, '2026-11-02', 120, 'Amazon', ['Shopping']),
    txn(2, '2026-11-04', 180, 'Amazon', ['Shopping']),
    txn(3, '2026-11-05', 60, 'WinCo Foods', ['Groceries']),
  ];
  const financeStore = {
    getBudgetConfig: vi.fn(() => ({
      budget: [{ timeframe: { start: new Date('2026-04-01T00:00:00Z') }, dayToDay: { amount: 3000, tags: ['Shopping'], rebalance: periodRule } }],
    })),
    getCompiledFinances: vi.fn(() => ({
      budgets: { '2026-04-01': { dayToDayBudget: { '2026-11': monthData }, shortTermBuckets } },
    })),
    getTransactions: vi.fn(() => stored),
    saveTransactions: vi.fn(),
  };
  const transactionGateway = { updateTransaction: updateTransaction || vi.fn(async () => ({})) };
  const compilationService = { compile: vi.fn(async () => ({})) };
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new DayToDayRebalanceService({
    financeStore, transactionGateway, compilationService, logger, today: () => '2026-11-10',
  });
  return { service, financeStore, transactionGateway, compilationService, logger };
}

describe('DayToDayRebalanceService', () => {
  it('retags fungible buys in Buxfer, mirrors the stored period, and recompiles', async () => {
    // Day 10: target 2000, balance 1700 → $300 over pace; Amazon 120 + 180 cover it.
    const monthData = november({ 2: 1300 }, [
      txn(1, '2026-11-02', 120, 'Amazon', ['Shopping']),
      txn(2, '2026-11-04', 180, 'Amazon', ['Shopping']),
      txn(3, '2026-11-05', 60, 'WinCo Foods', ['Groceries']),
    ]);
    const { service, financeStore, transactionGateway, compilationService } = setup({ monthData });

    const result = await service.rebalance('default');

    expect(transactionGateway.updateTransaction).toHaveBeenCalledWith(1, { tags: ['Housewares'] });
    expect(transactionGateway.updateTransaction).toHaveBeenCalledWith(2, { tags: ['Housewares'] });
    expect(transactionGateway.updateTransaction).toHaveBeenCalledTimes(2);
    const saved = financeStore.saveTransactions.mock.calls[0];
    expect(saved[0]).toBe('2026-04-01');
    expect(saved[1].map(t => t.tagNames[0])).toEqual(['Housewares', 'Housewares', 'Groceries']);
    expect(saved[1][0].tags).toBe('Housewares');
    expect(compilationService.compile).toHaveBeenCalledWith('default');
    expect(result).toMatchObject({ moved: 2, failed: 0, recompiled: true });
    expect(result.months[0]).toMatchObject({ month: '2026-11', status: 'overspent', gap: -300, balanceAfter: 2000 });
  });

  it('leaves everything alone when the month is on pace', async () => {
    const { service, transactionGateway, compilationService, financeStore } = setup({ monthData: november({ 3: 1020 }) });
    const result = await service.rebalance('default');
    expect(transactionGateway.updateTransaction).not.toHaveBeenCalled();
    expect(financeStore.saveTransactions).not.toHaveBeenCalled();
    expect(compilationService.compile).not.toHaveBeenCalled();
    expect(result.months[0].status).toBe('on-pace');
  });

  it('reports no wiggle room instead of touching non-fungible spending', async () => {
    const monthData = november({ 2: 1300 }, [txn(3, '2026-11-05', 300, 'WinCo Foods', ['Groceries'])]);
    const { service, transactionGateway, logger } = setup({ monthData });
    const result = await service.rebalance('default');
    expect(transactionGateway.updateTransaction).not.toHaveBeenCalled();
    expect(result.months[0]).toMatchObject({ status: 'overspent', candidates: 0, moves: [] });
    expect(logger.info).toHaveBeenCalledWith('finance.rebalance.no_wiggle_room', expect.objectContaining({ month: '2026-11' }));
  });

  it('skips periods without a rule', async () => {
    const { service, financeStore } = setup({ monthData: november({ 2: 1300 }), periodRule: null });
    const result = await service.rebalance('default');
    expect(financeStore.getTransactions).not.toHaveBeenCalled();
    expect(result.months).toEqual([]);
  });

  it('an edit echoing the transaction back (status "cleared") counts as moved', async () => {
    // Live 2026-11-09: transaction_edit answers with the edited transaction, whose
    // status is the transaction status. Reading that as a refusal skipped the mirror.
    const monthData = november({ 2: 1300 }, [txn(2, '2026-11-04', 180, 'Amazon', ['Shopping'])]);
    const updateTransaction = vi.fn(async (id) => ({ id, status: 'cleared', tags: 'Housewares' }));
    const { service, financeStore } = setup({ monthData, updateTransaction });
    const result = await service.rebalance('default');
    expect(result).toMatchObject({ moved: 1, failed: 0, recompiled: true });
    expect(financeStore.saveTransactions).toHaveBeenCalled();
  });

  it('a Buxfer edit answered with an error body counts as failed and is not mirrored', async () => {
    const monthData = november({ 2: 1300 }, [txn(2, '2026-11-04', 180, 'Amazon', ['Shopping'])]);
    const updateTransaction = vi.fn(async () => ({ status: 'ERROR: transaction is locked' }));
    const { service, financeStore, compilationService } = setup({ monthData, updateTransaction });
    const result = await service.rebalance('default');
    expect(result).toMatchObject({ moved: 0, failed: 1, recompiled: false });
    expect(financeStore.saveTransactions).not.toHaveBeenCalled();
    expect(compilationService.compile).not.toHaveBeenCalled();
  });

  it('caps moves at the room left in the bucket that owns the swing tag', async () => {
    const monthData = november({ 2: 1300 }, [
      txn(1, '2026-11-02', 120, 'Amazon', ['Shopping']),
      txn(2, '2026-11-04', 180, 'Amazon', ['Shopping']),
    ]);
    const { service, financeStore, transactionGateway } = setup({
      monthData,
      shortTermBuckets: { 'Home & Auto': { balance: 130, transactions: [] } },
    });
    financeStore.getBudgetConfig.mockReturnValue({
      budget: [{
        timeframe: { start: new Date('2026-04-01T00:00:00Z') },
        dayToDay: { amount: 3000, tags: ['Shopping'], rebalance: rule },
        shortTerm: [{ label: 'Home & Auto', tags: ['Home', 'Housewares'] }],
      }],
    });
    const result = await service.rebalance('default');
    expect(transactionGateway.updateTransaction).toHaveBeenCalledTimes(1);
    expect(transactionGateway.updateTransaction).toHaveBeenCalledWith(1, { tags: ['Housewares'] });
    expect(result.months[0].swingRoom).toBe(130);
  });

  it('a failed Buxfer edit is counted and not mirrored locally', async () => {
    const monthData = november({ 2: 1300 }, [
      txn(1, '2026-11-02', 120, 'Amazon', ['Shopping']),
      txn(2, '2026-11-04', 180, 'Amazon', ['Shopping']),
    ]);
    const updateTransaction = vi.fn(async (id) => { if (id === 2) throw new Error('boom'); return {}; });
    const { service, financeStore } = setup({ monthData, updateTransaction });
    const result = await service.rebalance('default');
    expect(result).toMatchObject({ moved: 1, failed: 1 });
    const saved = financeStore.saveTransactions.mock.calls[0][1];
    expect(saved.find(t => t.id === 2).tagNames).toEqual(['Shopping']);
    expect(saved.find(t => t.id === 1).tagNames).toEqual(['Housewares']);
  });
});
