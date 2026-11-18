import { it, expect, vi, afterEach } from 'vitest';
import { SelectWorkFlow } from './SelectWorkFlow.mjs';
import { harness, item } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
function setup() {
  const h = harness();
  resources.push(h);
  const state = h.make(),
    policy = {
      enabled: true,
      proactive: true,
      username: 'sample',
      revision: 'one',
      timezone: 'America/Los_Angeles',
      providers: {
        p: {
          type: 'todoist',
          accountId: 'personal',
          operations: ['read']
        }
      },
      domains: {
        personal: {
          provider: 'p',
          containerId: 'sample-project',
          role: 'tasks'
        }
      },
      attention: {
        rankerEnabled: true,
        staleRelevanceDays: 30,
        reviewWindows: [{
          days: [1, 2, 3, 4, 5, 6, 7],
          start: '00:00',
          end: '23:59'
        }],
        housekeepingDomains: ['personal'],
        ignoredOffersBeforeQuiet: 2,
        ignoredOfferHours: 36,
        quietDays: 30,
        offerExpiryHours: 24
      }
    };
  const view = {
      items: [item()],
      links: [],
      coverage: {
        complete: true
      },
      groundedReferences: []
    },
    context = {
      execute: vi.fn(async () => structuredClone(view))
    },
    reserve = vi.fn(async () => ({
      allowed: true,
      reservationId: 'reserved'
    })),
    budget = {
      reserve,
      history: async () => ({
        available: true,
        records: [],
        unansweredInvitations: []
      })
    },
    ranker = {
      rank: vi.fn(async () => {
        throw Error('offline');
      })
    };
  return {
    state,
    view,
    policy,
    reserve,
    ranker,
    selector: new SelectWorkFlow({
      context,
      state,
      budget,
      ranker,
      resolvePolicy: () => policy,
      userTimezone: () => policy.timezone,
      clock: () => AS_OF
    })
  };
}
it('returns one deterministic eligible opportunity, reserves only that offer and persists no backlog body', async () => {
  const x = setup();
  x.view.items = Array.from({
    length: 106
  }, (_, i) => item({
    ref: {
      ...item().ref,
      id: 'old-' + i
    }
  }));
  const result = await x.selector.execute({
    username: 'sample',
    asOf: AS_OF,
    explicitRequest: false
  });
  expect(result.offer.flowType).toBe('housekeeping');
  expect(x.reserve).toHaveBeenCalledTimes(1);
  expect(x.ranker.rank.mock.calls[0][0].eligible.length).toBeLessThanOrEqual(5);
  expect(Object.keys((await x.state.read({
    username: 'sample'
  })).offers)).toHaveLength(1);
});
it('preview metadata never reserves delivery capacity and empty selection creates no prompt', async () => {
  const x = setup();
  expect((await x.selector.execute({
    username: 'sample',
    asOf: AS_OF,
    conversationContext: {
      preview: true
    }
  })).offer).toBeTruthy();
  expect(x.reserve).not.toHaveBeenCalled();
  x.view.items = [];
  expect((await x.selector.execute({
    username: 'sample',
    asOf: AS_OF
  })).offer).toBe(null);
  expect(x.reserve).not.toHaveBeenCalled();
});
it('rechecks eligibility after ranker awaits and cannot resurrect a newly retired item', async () => {
  const x = setup();
  x.ranker.rank.mockImplementation(async () => {
    x.view.items = [];
    return {
      candidateId: 'invented',
      reason: 'x'
    };
  });
  expect((await x.selector.execute({
    username: 'sample',
    asOf: AS_OF
  })).offer).toBe(null);
  expect(x.reserve).not.toHaveBeenCalled();
});
it('drops preview metadata if owner history becomes unavailable during selection', async () => {
  const x = setup();
  let reads = 0;
  x.selector = new SelectWorkFlow({
    context: {
      execute: async () => x.view
    },
    state: x.state,
    budget: {
      reserve: x.reserve,
      history: async () => ({
        available: ++reads === 1,
        records: [],
        unansweredInvitations: []
      })
    },
    ranker: x.ranker,
    resolvePolicy: () => x.policy,
    clock: () => AS_OF
  });
  expect((await x.selector.execute({
    username: 'sample',
    asOf: AS_OF,
    conversationContext: {
      preview: true
    }
  })).offer).toBe(null);
});
it('retains a previewed choice at preparation without spending another ranking call or choosing a different item', async () => {
  const x = setup();
  x.view.items.push(item({
    ref: {
      ...item().ref,
      id: 'second'
    }
  }));
  x.ranker.rank.mockImplementation(async ({
    eligible
  }) => ({
    candidateId: eligible[1].id,
    reason: 'second'
  }));
  const preview = await x.selector.execute({
    username: 'sample',
    asOf: AS_OF,
    conversationContext: {
      preview: true
    }
  });
  x.ranker.rank.mockClear();
  const result = await x.selector.execute({
    username: 'sample',
    asOf: AS_OF,
    conversationContext: {
      offerId: preview.offer.id
    }
  });
  expect(result.offer.id).toBe(preview.offer.id);
  expect(x.ranker.rank).not.toHaveBeenCalled();
  expect(x.reserve).toHaveBeenCalledTimes(1);
});
