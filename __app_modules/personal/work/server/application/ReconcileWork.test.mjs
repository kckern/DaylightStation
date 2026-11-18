import { describe, it, expect, afterEach } from 'vitest';
import { ReconcileWork } from './ReconcileWork.mjs';
import { harness, snapshot, item, ref } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
function setup() {
  const h = harness();
  resources.push(h);
  const state = h.make();
  const policy = {
    enabled: true,
    domains: {
      personal: {
        provider: 'p',
        containerId: 'sample-project'
      }
    },
    providers: {
      p: {
        type: 'todoist',
        accountId: 'personal',
        operations: ['read']
      }
    },
    limits: {
      snapshotMaxAgeHours: 24
    }
  };
  return {
    state,
    service: new ReconcileWork({
      state,
      providers: new Map(),
      resolvePolicy: () => policy,
      userTimezone: () => 'America/Los_Angeles'
    }),
    policy
  };
}
const event = (type = 'completed', at = AS_OF + 1000) => ({
  id: 'provider-' + type + at,
  username: 'sample',
  ref,
  containerRef: item().containerRef,
  assigneeIds: [],
  type,
  occurredAt: at,
  observedAt: at,
  providerVersion: 'native-' + at,
  occurrenceId: String(at),
  origin: 'provider',
  causationId: 'same-command',
  sourceRefs: ['provider:source'],
  occurredAtEstimated: false,
  actorId: null
});
const next = (at = AS_OF + 1000) => snapshot({
  observedAt: at,
  revision: 'source-' + at,
  coverage: {
    ...snapshot().coverage,
    to: at
  }
});
describe('provider reconciliation without feedback', () => {
  it('seeds baseline without accomplishments and retains two actual recurring occurrences and reopen', async () => {
    const x = setup();
    expect((await x.service.observe({
      username: 'sample',
      snapshot: snapshot(),
      events: [event('completed', AS_OF - 1000)],
      asOf: AS_OF
    })).newEvents).toEqual([]);
    const events = [event(), event('reopened', AS_OF + 2000), event('completed', AS_OF + 3000)];
    expect((await x.service.observe({
      username: 'sample',
      snapshot: next(AS_OF + 3000),
      events,
      asOf: AS_OF + 3000
    })).newEvents).toHaveLength(3);
    expect((await x.service.observe({
      username: 'sample',
      snapshot: next(AS_OF + 3000),
      events,
      asOf: AS_OF + 3000
    })).newEvents).toEqual([]);
    const stored = Object.values((await x.state.read({
      username: 'sample'
    })).activities);
    expect(stored.filter(a => a.event.type === 'completed')).toHaveLength(2);
  });
  it('does not infer completion from disappearance, partial source or old observations', async () => {
    const x = setup();
    await x.service.observe({
      username: 'sample',
      snapshot: snapshot(),
      events: [],
      asOf: AS_OF
    });
    expect((await x.service.observe({
      username: 'sample',
      snapshot: next(),
      events: [],
      asOf: AS_OF + 1000
    })).newEvents).toEqual([]);
    const partial = next(AS_OF + 2000);
    partial.coverage.complete = false;
    expect((await x.service.observe({
      username: 'sample',
      snapshot: partial,
      events: [event()],
      asOf: AS_OF + 2000
    })).newEvents).toEqual([]);
    expect((await x.service.observe({
      username: 'sample',
      snapshot: snapshot(),
      events: [event('completed', AS_OF)],
      asOf: AS_OF + 3000
    })).newEvents).toEqual([]);
    expect(Object.keys((await x.state.read({
      username: 'sample'
    })).activities)).toHaveLength(0);
  });
  it('rejects another account, container, actor attribution guess or estimated time', async () => {
    const x = setup();
    await x.service.observe({
      username: 'sample',
      snapshot: snapshot(),
      events: [],
      asOf: AS_OF
    });
    const events = [{
      ...event(),
      ref: {
        ...ref,
        accountId: 'other'
      }
    }, {
      ...event(),
      containerRef: {
        ...ref,
        kind: 'container',
        id: 'other'
      }
    }, {
      ...event(),
      occurredAtEstimated: true
    }];
    expect((await x.service.observe({
      username: 'sample',
      snapshot: next(),
      events,
      asOf: AS_OF + 1000
    })).newEvents).toEqual([]);
    const foreign = {
      ...event(),
      actorId: 'someone-else'
    };
    const r = await x.service.observe({
      username: 'sample',
      snapshot: next(AS_OF + 2000),
      events: [foreign],
      asOf: AS_OF + 2000
    });
    expect(r.newEvents[0].actorId).toBe('someone-else');
  });
});
it('does not promote historical imports or malformed event attribution into activity', async () => {
  const x = setup();
  await x.service.observe({
    username: 'sample',
    snapshot: snapshot(),
    events: [],
    asOf: AS_OF
  });
  const events = [{
    ...event(),
    origin: 'backfill'
  }, {
    ...event(),
    origin: 'unknown'
  }, {
    ...event(),
    actorId: 123
  }];
  expect((await x.service.observe({
    username: 'sample',
    snapshot: next(),
    events,
    asOf: AS_OF + 1000
  })).newEvents).toEqual([]);
});
it('accepts explicitly scoped provider types when logical account labels overlap', async () => {
  const x = setup();
  x.policy.providers.other = {
    type: 'clickup',
    accountId: 'personal',
    operations: ['read']
  };
  x.policy.domains.other = {
    provider: 'other',
    containerId: 'other-list'
  };
  const result = await x.service.observe({
    username: 'sample',
    provider: 'todoist',
    snapshot: snapshot(),
    asOf: AS_OF
  });
  expect(result.coverage.complete).toBe(true);
});
