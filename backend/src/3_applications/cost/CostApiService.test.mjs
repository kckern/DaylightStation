import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CostApiService } from './CostApiService.mjs';

test('uses injected reference month and preserves reporting arguments', async () => {
  let args;
  const service = new CostApiService({
    reportingService: { getDashboard: async (...value) => { args = value; return { ok: true }; } },
    referenceTime: () => new Date(2026, 7, 28, 12),
  });
  assert.deepEqual(await service.dashboard({ household: 'home' }), { ok: true });
  assert.equal(args[0], 'home');
  assert.equal(args[1].start.getFullYear(), 2026);
  assert.equal(args[1].start.getMonth(), 7);
  assert.equal(args[1].start.getDate(), 1);
  assert.equal(args[1].end.getDate(), 31);
});

test('preserves unconfigured budget response', async () => {
  const service = new CostApiService({ reportingService: {}, referenceTime: () => new Date(0) });
  assert.deepEqual(await service.budgetStatuses({}), { budgets: [], message: 'Budget service not configured' });
});
