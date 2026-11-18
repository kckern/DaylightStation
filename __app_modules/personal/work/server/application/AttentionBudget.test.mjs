import { it, expect, afterEach } from 'vitest';
import { AttentionBudget } from './AttentionBudget.mjs';
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
  const existing = {
    deliveries: [],
    reservations: [],
    unansweredInvitations: [],
    available: true
  };
  const policy = {
    enabled: true,
    revision: 'policy',
    timezone: 'America/Los_Angeles',
    attention: {
      maxProactiveUnitsPerDay: 2,
      maxHousekeepingPer7Days: 1,
      itemCooldownDays: 30,
      offerExpiryHours: 24
    }
  };
  const options = {
    state,
    history: {
      read: async () => structuredClone(existing)
    },
    resolvePolicy: () => policy,
    userTimezone: () => policy.timezone,
    clock: () => now
  };
  return {
    state,
    existing,
    policy,
    options,
    budget: new AttentionBudget(options),
    advance: ms => {
      now += ms;
    },
    now: () => now
  };
}
const request = (x, id, questionUnits = 1, channel = 'morning') => ({
  username: 'sample',
  decisionId: id,
  questionUnits,
  channel,
  flowType: channel === 'morning' ? 'morning' : 'housekeeping',
  refKey: 'ref-' + id,
  asOf: x.now(),
  expiresAt: x.now() + 86400000
});
it('shares two units with concurrent senders, preserves retry IDs and creates no reservation for zero units', async () => {
  const x = setup();
  const first = await x.budget.reserve(request(x, 'first'));
  expect(first.allowed).toBe(true);
  const raced = await Promise.all([x.budget.reserve(request(x, 'second')), x.budget.reserve(request(x, 'third'))]);
  expect(raced.filter(r => r.allowed)).toHaveLength(1);
  expect(await x.budget.reserve(request(x, 'first'))).toMatchObject({
    allowed: false,
    reservationId: first.reservationId
  });
  expect(await x.budget.reserve(request(x, 'empty', 0))).toMatchObject({
    allowed: true,
    reservationId: null
  });
  expect(Object.keys((await x.state.read({
    username: 'sample'
  })).attention)).toHaveLength(2);
});
it('ingests existing KB asks and distinguishes ACK exposure from uncertain capacity after restart', async () => {
  const x = setup();
  x.existing.deliveries = [{
    id: 'kb:old',
    day: '2026-11-17',
    status: 'delivered',
    channel: 'morning',
    questionUnits: 2,
    deliveredAt: x.now() - 1000
  }];
  expect((await x.budget.reserve(request(x, 'work', 1, 'housekeeping'))).reason).toBe('daily_budget');
  x.existing.deliveries = [];
  const r = await x.budget.reserve(request(x, 'work', 1, 'housekeeping'));
  await x.budget.fail({
    username: 'sample',
    reservationId: r.reservationId,
    uncertain: true,
    asOf: x.now()
  });
  expect((await new AttentionBudget(x.options).reserve(request(x, 'work', 1, 'housekeeping'))).allowed).toBe(false);
  expect((await x.state.read({
    username: 'sample'
  })).attention[r.reservationId]).toMatchObject({
    status: 'quarantined',
    deliveredAt: null
  });
});
it('known failure releases capacity, successful ACK holds rolling weekly/item limits', async () => {
  const x = setup();
  const r = await x.budget.reserve(request(x, 'failed', 2));
  await x.budget.fail({
    username: 'sample',
    reservationId: r.reservationId,
    uncertain: false,
    asOf: x.now()
  });
  const next = await x.budget.reserve(request(x, 'offer', 1, 'housekeeping'));
  expect(next.allowed).toBe(true);
  await x.budget.acknowledge({
    username: 'sample',
    reservationId: next.reservationId,
    botMessageId: '42',
    deliveredAt: x.now()
  });
  x.advance(86400000);
  expect((await x.budget.reserve(request(x, 'later', 1, 'housekeeping'))).reason).toBe('weekly_housekeeping');
});
it('keeps an undispatched logical preparation fenced at midnight until its owner cancels it', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-18T07:59:59Z') - x.now());
  const a = await x.budget.reserve(request(x, 'midnight'));
  x.advance(2000);
  expect((await x.budget.reserve(request(x, 'midnight'))).allowed).toBe(false);
  expect((await x.budget.dispatch({
    username: 'sample',
    reservationId: a.reservationId
  })).allowed).toBe(false);
});
it('a lost ACK transaction retains capacity and never grants a repeat send', async () => {
  const x = setup(),
    a = await x.budget.reserve(request(x, 'ack'));
  const original = x.state.transact.bind(x.state);
  x.state.transact = async () => {
    throw Error('disk');
  };
  await expect(x.budget.acknowledge({
    username: 'sample',
    reservationId: a.reservationId,
    botMessageId: '42',
    deliveredAt: x.now()
  })).rejects.toThrow();
  x.state.transact = original;
  expect((await new AttentionBudget(x.options).reserve(request(x, 'ack'))).allowed).toBe(false);
  expect(Object.values((await x.state.read({
    username: 'sample'
  })).attention)[0].deliveredAt).toBe(null);
});
it('direct requests bypass proactive capacity and unavailable history fails closed for unsolicited sends', async () => {
  const x = setup();
  x.existing.available = false;
  expect((await x.budget.reserve(request(x, 'unavailable'))).allowed).toBe(false);
  expect((await x.budget.reserve(request(x, 'manual', 5, 'direct_request'))).allowed).toBe(true);
});
it('keeps both sides of the repeated DST hour in one local-day budget', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-01T08:30:00Z') - x.now());
  expect((await x.budget.reserve(request(x, 'dst-first', 2))).allowed).toBe(true);
  x.advance(3600000);
  expect((await x.budget.reserve(request(x, 'dst-repeat'))).reason).toBe('daily_budget');
});
it('recovers canonical ACK after the caller loses the transaction acknowledgement', async () => {
  const x = setup(),
    a = await x.budget.reserve(request(x, 'ack-lost'));
  const original = x.state.transact.bind(x.state);
  x.state.transact = async args => {
    await original(args);
    throw Error('lost ack');
  };
  await expect(x.budget.acknowledge({
    username: 'sample',
    reservationId: a.reservationId,
    botMessageId: '42',
    deliveredAt: x.now()
  })).rejects.toThrow();
  x.state.transact = original;
  expect((await new AttentionBudget(x.options).reserve(request(x, 'ack-lost'))).allowed).toBe(false);
  expect((await x.state.read({
    username: 'sample'
  })).attention[a.reservationId].status).toBe('delivered');
});
it('rechecks actual date and configuration after awaited cross-owner history before reserving', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-18T07:59:59Z') - x.now());
  x.options.history.read = async () => {
    x.advance(2000);
    return x.existing;
  };
  const b = new AttentionBudget(x.options);
  expect((await b.reserve(request(x, 'cross-during-read'))).allowed).toBe(false);
  expect(Object.keys((await x.state.read({
    username: 'sample'
  })).attention ?? {})).toHaveLength(0);
  const y = setup();
  y.options.history.read = async () => {
    y.policy.revision = 'changed';
    return y.existing;
  };
  expect((await new AttentionBudget(y.options).reserve(request(y, 'revoked'))).allowed).toBe(false);
});
it('holds in-flight capacity across midnight and records an unreleased acknowledged delivery on its actual local day', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-18T07:59:59Z') - x.now());
  const a = await x.budget.reserve(request(x, 'in-flight', 2));
  x.advance(2000);
  expect((await x.budget.reserve(request(x, 'another-sender'))).reason).toBe('daily_budget');
  await x.budget.acknowledge({
    username: 'sample',
    reservationId: a.reservationId,
    botMessageId: '42',
    deliveredAt: x.now()
  });
  expect((await x.state.read({
    username: 'sample'
  })).attention[a.reservationId]).toMatchObject({
    status: 'delivered',
    day: '2026-11-18'
  });
  expect((await x.budget.reserve(request(x, 'third'))).allowed).toBe(false);
});
it('fences an in-flight logical send across midnight and restart with one dispatch claim', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-18T07:59:59Z') - x.now());
  const first = await x.budget.reserve(request(x, 'midnight-send', 1));
  expect(await x.budget.dispatch({
    username: 'sample',
    reservationId: first.reservationId
  })).toMatchObject({
    allowed: true
  });
  x.advance(2000);
  expect((await new AttentionBudget(x.options).reserve(request(x, 'midnight-send', 1))).allowed).toBe(false);
  expect((await x.budget.dispatch({
    username: 'sample',
    reservationId: first.reservationId
  })).allowed).toBe(false);
  await expect(x.budget.acknowledge({
    username: 'sample',
    reservationId: first.reservationId,
    botMessageId: '99',
    deliveredAt: x.now()
  })).resolves.toBeDefined();
});
it('reserves only one concurrent Work invitation while allowing an ordinary KB question', async () => {
  const x = setup();
  const args = id => ({
    ...request(x, id, 1, 'review'),
    flowType: 'reconcile'
  });
  const grants = await Promise.all([x.budget.reserve(args('a')), x.budget.reserve(args('b'))]);
  expect(grants.filter(g => g.allowed)).toHaveLength(1);
  expect((await x.budget.reserve(request(x, 'kb', 1))).allowed).toBe(true);
});
it('does not dispatch a prepared grant after its day or policy changes', async () => {
  const x = setup();
  const r = await x.budget.reserve(request(x, 'revoked'));
  x.policy.revision = 'new';
  expect((await x.budget.dispatch({
    username: 'sample',
    reservationId: r.reservationId
  })).allowed).toBe(false);
});
it('issues exactly one transport claim under concurrent dispatchers', async () => {
  const x = setup();
  const grant = await x.budget.reserve(request(x, 'dispatch-race'));
  const results = await Promise.all([x.budget.dispatch({
    username: 'sample',
    reservationId: grant.reservationId
  }), x.budget.dispatch({
    username: 'sample',
    reservationId: grant.reservationId
  })]);
  expect(results.filter(r => r.allowed)).toHaveLength(1);
});
it('rechecks a reduced owner allowance against already exposed units at dispatch', async () => {
  const x = setup();
  x.existing.deliveries = [{
    id: 'kb:spent',
    day: '2026-11-17',
    channel: 'morning',
    status: 'delivered',
    questionUnits: 1,
    deliveredAt: x.now() - 1
  }];
  const grant = await x.budget.reserve(request(x, 'backoff-change'));
  x.existing.maxQuestionUnits = 1;
  expect((await x.budget.dispatch({
    username: 'sample',
    reservationId: grant.reservationId
  })).allowed).toBe(false);
});
it('rechecks actual day after an awaited owner history read at dispatch', async () => {
  const x = setup();
  x.advance(Date.parse('2026-11-18T07:59:59Z') - x.now());
  const grant = await x.budget.reserve(request(x, 'slow-dispatch'));
  x.options.history.read = async () => {
    x.advance(2000);
    return x.existing;
  };
  expect((await x.budget.dispatch({
    username: 'sample',
    reservationId: grant.reservationId
  })).allowed).toBe(false);
});
