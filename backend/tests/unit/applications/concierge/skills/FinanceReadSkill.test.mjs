import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FinanceReadSkill } from '../../../../../src/3_applications/concierge/skills/FinanceReadSkill.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

class FakeFin {
  async accountBalances() { return [{ accountId: '1', name: 'Checking', balance: 100, currency: 'USD' }]; }
  async recentTransactions({ days }) { return [{ date: '2026-04-30', amount: -10, description: `txn ${days}d`, account: 'Checking' }]; }
  async budgetSummary({ periodStart }) { return { income: 5000, byCategory: { Food: 200 }, asOf: periodStart ?? '2026-04-01' }; }
}

describe('FinanceReadSkill', () => {
  const s = new FinanceReadSkill({ finance: new FakeFin(), logger: silentLogger });

  it('exposes the three tools', () => {
    const names = s.getTools().map((t) => t.name).sort();
    assert.deepStrictEqual(names, ['account_balances', 'budget_summary', 'recent_transactions']);
  });

  it('account_balances returns accounts', async () => {
    const tool = s.getTools().find((t) => t.name === 'account_balances');
    const r = await tool.execute({}, {});
    assert.strictEqual(r.accounts.length, 1);
  });

  it('recent_transactions defaults to 7 days', async () => {
    const tool = s.getTools().find((t) => t.name === 'recent_transactions');
    const r = await tool.execute({}, {});
    assert.match(r.transactions[0].description, /7d/);
  });

  it('throws without IFinanceRead', () => {
    assert.throws(() => new FinanceReadSkill({ finance: {} }), /IFinanceRead/);
  });
});
