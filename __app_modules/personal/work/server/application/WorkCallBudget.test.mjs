import { it, expect, afterEach } from 'vitest';
import { WorkCallBudget } from './WorkCallBudget.mjs';
import { harness } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
function setup() {
  const h = harness();
  resources.push(h);
  const state = h.make();
  let now = AS_OF;
  const policy = {
    enabled: true,
    timezone: 'America/Los_Angeles',
    limits: {
      modelCallsPerLocalDay: 4
    }
  };
  const make = store => new WorkCallBudget({
    state: store,
    resolvePolicy: () => policy,
    clock: () => now
  });
  return {
    h,
    state,
    policy,
    budget: make(state),
    make,
    setNow: value => {
      now = value;
    }
  };
}
it('shares four durable attempts across KB and Work, including failed attempts and restart', async () => {
  const x = setup();
  for (let n = 0; n < 3; n++) expect((await x.budget.reserve({
    username: 'sample',
    receiptId: 'kb-' + n,
    scope: 'knowledge-extraction',
    asOf: AS_OF
  })).allowed).toBe(true);
  expect((await x.budget.reserve({
    username: 'sample',
    receiptId: 'work-1',
    scope: 'journal-intent',
    asOf: AS_OF
  })).allowed).toBe(true);
  await x.state.close();
  const restarted = x.make(x.h.make());
  expect((await restarted.reserve({
    username: 'sample',
    receiptId: 'rank-1',
    scope: 'workflow-rank',
    asOf: AS_OF
  })).allowed).toBe(false);
  expect((await restarted.reserve({
    username: 'sample',
    receiptId: 'work-1',
    scope: 'journal-intent',
    asOf: AS_OF
  })).allowed).toBe(false);
});
it('reserves once per receipt/scope and cannot overspend through concurrency', async () => {
  const x = setup();
  const results = await Promise.all(Array.from({
    length: 5
  }, (_, n) => x.budget.reserve({
    username: 'sample',
    receiptId: 'call-' + n,
    scope: 'journal-intent',
    asOf: AS_OF
  })));
  expect(results.filter(r => r.allowed)).toHaveLength(4);
  expect((await x.budget.reserve({
    username: 'sample',
    receiptId: 'call-0',
    scope: 'journal-intent',
    asOf: AS_OF
  })).allowed).toBe(false);
});
it('uses actual local call date rather than an old source timestamp and isolates users', async () => {
  const x = setup();
  for (let n = 0; n < 4; n++) await x.budget.reserve({
    username: 'sample',
    receiptId: 'call-' + n,
    scope: 'journal-intent',
    asOf: AS_OF
  });
  expect((await x.budget.reserve({
    username: 'sample',
    receiptId: 'old-source',
    scope: 'journal-intent',
    asOf: AS_OF - 86400000
  })).allowed).toBe(false);
  expect((await x.budget.reserve({
    username: 'other',
    receiptId: 'call-0',
    scope: 'journal-intent',
    asOf: AS_OF
  })).allowed).toBe(true);
  x.setNow(AS_OF + 86400000);
  expect((await x.budget.reserve({
    username: 'sample',
    receiptId: 'next-day',
    scope: 'journal-intent',
    asOf: AS_OF + 86400000
  })).allowed).toBe(true);
});
