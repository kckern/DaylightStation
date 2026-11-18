import { it, expect } from 'vitest';
import { selectOpportunities } from './eligibility.mjs';
import { workflowRegistry } from './workflowRegistry.mjs';
import { item, ref, refKey } from '../../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../../tests/_lib/work/observations.mjs';
const policy = () => ({
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
    staleRelevanceDays: 30,
    reviewWindows: [],
    housekeepingDomains: [],
    ignoredOffersBeforeQuiet: 2,
    ignoredOfferHours: 36,
    quietDays: 30,
    offerExpiryHours: 24
  }
});
function input() {
  return {
    context: {
      items: [item({
        modifiedAt: null
      })],
      links: [],
      coverage: {
        complete: true
      },
      groundedReferences: []
    },
    relevance: {},
    history: {
      records: [],
      unansweredInvitations: []
    },
    policy: policy(),
    asOf: AS_OF,
    explicitRequest: false
  };
}
const optIn = x => {
  x.policy.attention.reviewWindows = [{
    days: [1, 2, 3, 4, 5, 6, 7],
    start: '00:00',
    end: '23:59'
  }];
  x.policy.attention.housekeepingDomains = ['personal'];
  return x;
};
it('does not promote 106 old in-progress tasks merely because they were fetched today', () => {
  const x = input();
  x.context.items = Array.from({
    length: 106
  }, (_, i) => item({
    ref: {
      ...ref,
      id: 'old-' + i
    },
    status: {
      native: 'doing',
      category: 'in_progress'
    },
    createdAt: AS_OF - 365 * 86400000,
    modifiedAt: null,
    observedAt: AS_OF
  }));
  expect(selectOpportunities(x).eligible).toEqual([]);
});
it('allows only opted-in windowed legacy review and never invents a source date or overdue claim', () => {
  const x = optIn(input());
  const r = selectOpportunities(x);
  expect(r.eligible).toHaveLength(1);
  expect(r.eligible[0]).toMatchObject({
    flowType: 'housekeeping',
    reason: 'unknown_source_dates'
  });
  expect(r.eligible[0].evidenceRefs).toEqual([]);
  x.policy.attention.housekeepingDomains = [];
  expect(selectOpportunities(x).eligible).toHaveLength(0);
});
it('honors paused, retired and snoozed overlays across fresh snapshots and aliases', () => {
  const x = optIn(input());
  x.relevance[refKey] = {
    state: 'paused',
    reviewAt: AS_OF + 1000,
    snoozedUntil: null,
    confirmedAt: AS_OF - 1
  };
  expect(selectOpportunities(x).eligible).toHaveLength(0);
  x.relevance[refKey].reviewAt = AS_OF;
  expect(selectOpportunities(x).eligible[0].flowType).toBe('reactivate');
  x.relevance[refKey] = {
    state: 'retired',
    reviewAt: null
  };
  expect(selectOpportunities(x).eligible).toHaveLength(0);
  expect(selectOpportunities({
    ...x,
    explicitRequest: true
  }).eligible).toHaveLength(1);
  x.relevance[refKey] = {
    state: 'active',
    confirmedAt: AS_OF - 1,
    snoozedUntil: AS_OF + 1000
  };
  expect(selectOpportunities(x).eligible).toHaveLength(0);
});
it('native provider pause stays quiet until an explicit date or request', () => {
  const x = optIn(input());
  x.context.items[0].status = {
    native: 'back burner',
    category: 'paused'
  };
  expect(selectOpportunities(x).eligible).toHaveLength(0);
  expect(selectOpportunities({
    ...x,
    explicitRequest: true
  }).eligible).toHaveLength(1);
});
it('requires grounded current user relevance and preserves stricter linked KB policies', () => {
  const x = input();
  x.context.groundedReferences = [{
    ref,
    at: AS_OF - 1000,
    evidenceRef: 'journal:one',
    verified: true
  }];
  expect(selectOpportunities(x).eligible).toHaveLength(1);
  x.context.links = [{
    workRef: ref,
    kbObjectId: 'loop.private'
  }];
  x.context.knowledgeEligibility = {
    'loop.private': {
      allowed: false
    }
  };
  expect(selectOpportunities(x).eligible).toHaveLength(0);
});
it('offers coverage repair without asserting a cached task open or completed', () => {
  const x = input();
  x.relevance[refKey] = {
    state: 'active',
    confirmedAt: AS_OF - 1000
  };
  x.context.coverage = {
    complete: false,
    reason: 'partial'
  };
  const offer = selectOpportunities(x).eligible[0];
  expect(offer).toMatchObject({
    flowType: 'coverage_repair',
    reason: 'stale_or_partial_source'
  });
});
it('two delivered ignored housekeeping invitations mature after 36h into 30 quiet days', () => {
  const x = optIn(input());
  x.history.records = [8, 2].map(days => ({
    id: 'sent-' + days,
    channel: 'housekeeping',
    flowType: 'housekeeping',
    status: 'delivered',
    deliveredAt: AS_OF - days * 86400000,
    response: null
  }));
  expect(selectOpportunities(x).eligible).toHaveLength(0);
  x.history.records[1].response = {
    action: 'later',
    at: AS_OF - 1000
  };
  expect(selectOpportunities(x).eligible).toHaveLength(1);
  x.history.records = x.history.records.map(r => ({
    ...r,
    status: 'prepared',
    deliveredAt: null
  }));
  expect(selectOpportunities(x).eligible).toHaveLength(1);
});
it('scopes relevance by provider/account/ref and registry offers no destructive shortcut', () => {
  const x = optIn(input());
  x.policy.providers.other = {
    type: 'clickup',
    accountId: 'other',
    operations: ['read']
  };
  x.policy.domains.other = {
    provider: 'other',
    containerId: 'other-list',
    role: 'projects'
  };
  x.policy.attention.housekeepingDomains.push('other');
  x.context.items.push(item({
    ref: {
      ...ref,
      provider: 'clickup',
      accountId: 'other'
    },
    containerRef: {
      provider: 'clickup',
      accountId: 'other',
      kind: 'container',
      id: 'other-list'
    }
  }));
  x.relevance[refKey] = {
    state: 'retired'
  };
  expect(selectOpportunities(x).eligible.map(o => o.ref.accountId)).toEqual(['other']);
  expect(workflowRegistry.get('housekeeping').allowedActions).toEqual(['keep_active', 'snooze', 'retire']);
  expect(workflowRegistry.get('delete')).toBe(null);
});
it('ignored legacy offers quiet housekeeping without suppressing newly grounded active work', () => {
  const x = optIn(input());
  x.context.groundedReferences = [{
    ref,
    at: AS_OF - 1,
    evidenceRef: 'journal:fresh',
    verified: true
  }];
  x.history.records = [8, 2].map(d => ({
    id: String(d),
    channel: 'housekeeping',
    flowType: 'housekeeping',
    status: 'delivered',
    deliveredAt: AS_OF - d * 86400000,
    response: null
  }));
  expect(selectOpportunities(x).eligible[0]?.reason).toBe('recent_grounded_reference');
});
it('turns owner-approved pending reviews into one bounded invitation without exposing proposal content', () => {
  const x = input();
  x.context.items = [];
  x.context.pendingReview = {
    available: true,
    due: true,
    ids: ['proposal.one', 'proposal.two'],
    count: 2,
    revision: 'kb-rev'
  };
  const r = selectOpportunities(x);
  expect(r.eligible).toHaveLength(1);
  expect(r.eligible[0]).toMatchObject({
    flowType: 'knowledge_review',
    questionUnits: 1,
    ref: null,
    evidenceRefs: ['proposal.one', 'proposal.two']
  });
  x.context.pendingReview.available = false;
  expect(selectOpportunities(x).eligible).toHaveLength(0);
});
