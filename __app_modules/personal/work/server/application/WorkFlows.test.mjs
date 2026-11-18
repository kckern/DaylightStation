import { it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { WorkFlows } from './WorkFlows.mjs';
import { WorkDecisions } from './WorkDecisions.mjs';
import { SelectWorkFlow } from './SelectWorkFlow.mjs';
import { AttentionBudget } from './AttentionBudget.mjs';
import { createWorkCallbackTokens } from '../adapters/WorkCallbackTokens.mjs';
import { WorkPrincipalAuthority } from '../adapters/WorkPrincipalAuthority.mjs';
import { harness, item, refKey, commit, relevance } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
async function setup(count = 1) {
  const h = harness();
  resources.push(h);
  const state = h.make();
  let now = AS_OF,
    mode = 'knowledge',
    flow;
  const policy = {
    enabled: true,
    proactive: true,
    username: 'sample',
    revision: 'policy',
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
      maxProactiveUnitsPerDay: 2,
      maxHousekeepingPer7Days: 1,
      itemCooldownDays: 30,
      ignoredOffersBeforeQuiet: 2,
      ignoredOfferHours: 36,
      quietDays: 30,
      staleRelevanceDays: 30,
      offerExpiryHours: 24,
      reviewWindows: [{
        days: [1, 2, 3, 4, 5, 6, 7],
        start: '00:00',
        end: '23:59'
      }],
      housekeepingDomains: ['personal'],
      rankerEnabled: false
    }
  };
  const rows = Array.from({
      length: count
    }, (_, i) => item({
      ref: {
        ...item().ref,
        id: i ? 'item-' + i : item().ref.id
      },
      title: 'Legacy item ' + i
    })),
    identity = {
      username: 'sample',
      senderId: '101',
      conversationId: 'telegram:private'
    },
    authority = new WorkPrincipalAuthority({
      identityForSender: id => id === '101' ? identity : null,
      webhookSecret: 'secret',
      clock: () => now
    });
  const principal = (token = null, messageId = '99') => authority.capturePrincipal({
    event: {
      platform: 'telegram',
      type: token ? 'callback' : 'text',
      platformUserId: '101',
      conversationId: identity.conversationId,
      messageId,
      metadata: {
        senderId: '101',
        chatId: '101',
        chatType: 'private'
      },
      payload: {
        callbackId: randomUUID(),
        callbackData: token
      }
    },
    webhookSecret: 'secret'
  });
  const history = {
      available: true,
      deliveries: [],
      reservations: [],
      unansweredInvitations: []
    },
    budget = new AttentionBudget({
      state,
      history: {
        read: async () => history
      },
      resolvePolicy: () => policy,
      userTimezone: () => policy.timezone,
      clock: () => now
    });
  const context = {
    execute: async () => ({
      items: structuredClone(rows),
      containers: [],
      links: [],
      coverage: {
        complete: true
      }
    }),
    getItem: vi.fn(async ({
      ref
    }) => rows.find(r => r.ref.id === ref.id)),
    morningGate: async () => ({
      mode,
      questionCount: 1,
      askDate: '2026-11-17'
    }),
    identityForUser: () => identity,
    refresh: vi.fn(async () => {}),
    renderFlow: input => flow.renderFlow(input),
    renderInvitation: input => flow.renderInvitation(input),
    applyFlowChoice: input => flow.applyFlowChoice(input)
  };
  const commands = {
      execute: vi.fn()
    },
    decisions = new WorkDecisions({
      state,
      commands,
      context,
      resolvePolicy: () => policy,
      verifyPrincipal: p => authority.verify(p),
      clock: () => now,
      nextId: randomUUID,
      tokens: createWorkCallbackTokens()
    });
  const selector = new SelectWorkFlow({
    context,
    state,
    budget,
    resolvePolicy: () => policy,
    userTimezone: () => policy.timezone,
    clock: () => now
  });
  flow = new WorkFlows({
    state,
    selector,
    decisions,
    commands,
    context,
    budget,
    verifyPrincipal: p => authority.verify(p),
    verifyDecisionClaim: input => decisions.verifyFlowClaim(input),
    resolvePolicy: () => policy,
    userTimezone: () => policy.timezone,
    clock: () => now
  });
  const deliver = async page => {
    await decisions.recordDelivery({
      username: 'sample',
      decisionId: page.decisionId,
      botMessageId: '300',
      asOf: now
    });
  };
  const tap = async (page, label) => {
    const token = page.choices.flat().find(b => b.text === label)?.callback_data;
    expect(token).toBeTruthy();
    return flow.respond({
      principal: principal(token, '300'),
      token,
      botMessageId: '300',
      asOf: now
    });
  };
  return {
    state,
    flow,
    decisions,
    commands,
    policy,
    rows,
    context,
    budget,
    principal,
    deliver,
    tap,
    now: () => now,
    advance: ms => {
      now += ms;
    },
    setMode: v => {
      mode = v;
    }
  };
}
it('manual cleanup pages show at most three items and Stop tracking changes only local relevance', async () => {
  const x = await setup(106),
    page = await x.flow.open({
      principal: x.principal(),
      flowType: 'housekeeping',
      asOf: x.now()
    });
  expect(page.text).not.toContain('Legacy item 3');
  expect(page.text.match(/Legacy item/g)).toHaveLength(3);
  await x.deliver(page);
  const chosen = await x.tap(page, 'This one');
  expect(chosen.page.choices.flat().map(b => b.text)).toEqual(['Keep active', 'Revisit in30 days', 'Stop tracking']);
  await x.deliver(chosen.page);
  expect((await x.tap(chosen.page, 'Stop tracking')).status).toBe('applied');
  expect(Object.values((await x.state.read({
    username: 'sample'
  })).relevance).filter(r => r.state === 'retired')).toHaveLength(1);
  expect(x.commands.execute).not.toHaveBeenCalled();
  expect(x.rows[0].status.category).toBe('open');
});
it('snoozes thirty local calendar days across DST and duplicate controls cannot act twice', async () => {
  const x = await setup();
  x.advance(Date.parse('2026-10-20T15:00:00Z') - x.now());
  const p = await x.flow.open({
    principal: x.principal(),
    flowType: 'housekeeping',
    asOf: x.now()
  });
  await x.deliver(p);
  const chosen = await x.tap(p, 'This one');
  await x.deliver(chosen.page);
  expect((await x.tap(chosen.page, 'Revisit in30 days')).status).toBe('applied');
  const r = (await x.state.read({
    username: 'sample'
  })).relevance[refKey];
  expect(r.snoozedUntil).toBe(Date.parse('2026-11-19T16:00:00Z'));
  expect((await x.tap(chosen.page, 'Revisit in30 days')).status).toBe('already_applied');
});
it('rejects stale Keep active after another route retired the item and rejects a direct forged choice', async () => {
  const x = await setup(),
    p = await x.flow.open({
      principal: x.principal(),
      flowType: 'housekeeping',
      asOf: x.now()
    });
  await x.deliver(p);
  const chosen = await x.tap(p, 'This one');
  await x.deliver(chosen.page);
  await commit(x.state, 'retire-other-route', [relevance('retired')]);
  expect((await x.tap(chosen.page, 'Keep active')).status).toBe('denied');
  expect(Object.values((await x.state.read({
    username: 'sample'
  })).relevance).filter(r => r.state === 'retired')).toHaveLength(1);
  expect(await x.flow.applyFlowChoice({
    principal: x.principal(),
    flowState: {
      flowType: 'housekeeping'
    },
    choice: {
      action: 'choose',
      value: {
        action: 'keep_active'
      }
    },
    asOf: x.now()
  })).toMatchObject({
    status: 'denied'
  });
});
it('server invitations require current knowledge mode, one remaining unit and an actual ACK before processing', async () => {
  const x = await setup();
  x.setMode('legacy');
  expect((await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1,
    asOf: x.now()
  })).offer).toBe(null);
  x.setMode('knowledge');
  expect((await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 0,
    asOf: x.now()
  })).offer).toBe(null);
  const selected = await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1,
    asOf: x.now()
  });
  const p = await x.flow.prepareForMorning({
    username: 'sample',
    offerId: selected.offer.id,
    askDate: '2026-11-17',
    asOf: x.now()
  });
  expect(p.text).not.toContain('Legacy item');
  expect(p.choices.flat().map(b => b.text)).toEqual(['Review', 'Later', 'Dismiss']);
  const token = p.choices[0][0].callback_data;
  expect((await x.flow.respond({
    principal: x.principal(token, '300'),
    token,
    botMessageId: '300',
    asOf: x.now()
  })).status).toBe('denied');
  await x.flow.recordDelivery({
    username: 'sample',
    decisionId: p.decisionId,
    botMessageId: '300',
    asOf: x.now()
  });
  const clicked = await x.tap(p, 'Review');
  expect(clicked.page.text).toContain('Legacy item 0');
  expect(x.commands.execute).not.toHaveBeenCalled();
});
it('does not apply local relevance when a live read returns after the bound offer expires', async () => {
  const x = await setup(),
    p = await x.flow.open({
      principal: x.principal(),
      flowType: 'housekeeping',
      asOf: x.now()
    });
  await x.deliver(p);
  const chosen = await x.tap(p, 'This one');
  await x.deliver(chosen.page);
  x.context.getItem.mockImplementation(async () => {
    x.advance(86400001);
    return x.rows[0];
  });
  expect((await x.tap(chosen.page, 'Keep active')).status).toBe('denied');
  expect((await x.state.read({
    username: 'sample'
  })).relevance[refKey]).toBeUndefined();
});
it('records housekeeping exposure on ACK without promoting active or invalidating its own controls', async () => {
  const x = await setup(),
    selected = await x.flow.selectForMorning({
      username: 'sample',
      askDate: '2026-11-17',
      remainingUnits: 1,
      asOf: x.now()
    }),
    page = await x.flow.prepareForMorning({
      username: 'sample',
      offerId: selected.offer.id,
      askDate: '2026-11-17',
      asOf: x.now()
    });
  await x.flow.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '300',
    asOf: x.now()
  });
  expect((await x.state.read({
    username: 'sample'
  })).relevance[refKey]).toMatchObject({
    state: 'unconfirmed',
    lastOfferedAt: x.now()
  });
  expect((await x.tap(page, 'Review')).page).toBeTruthy();
});
it('coverage repair can check a stale source without applying the cached native version as a write precondition', async () => {
  const x = await setup();
  await commit(x.state, 'active-for-repair', [relevance('active')]);
  x.context.execute = async () => ({
    items: x.rows,
    containers: [],
    links: [],
    coverage: {
      complete: false,
      reason: 'partial'
    }
  });
  x.context.getItem.mockResolvedValue({
    ...x.rows[0],
    version: 'new-live-version'
  });
  const selected = await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1,
    asOf: x.now()
  });
  expect(selected.offer.flowType).toBe('coverage_repair');
  const page = await x.flow.prepareForMorning({
    username: 'sample',
    offerId: selected.offer.id,
    askDate: '2026-11-17',
    asOf: x.now()
  });
  await x.flow.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '300',
    asOf: x.now()
  });
  const chosen = await x.tap(page, 'Review');
  expect(chosen.page.text).toContain('stale or partial');
  await x.deliver(chosen.page);
  expect((await x.tap(chosen.page, 'Refresh')).status).toBe('refreshed');
  expect(x.context.refresh).toHaveBeenCalledTimes(1);
  expect(x.commands.execute).not.toHaveBeenCalled();
});
it('does not invent KB link choices without verified owner candidates', async () => {
  const x = await setup(),
    page = await x.flow.open({
      principal: x.principal(),
      flowType: 'create_link',
      asOf: x.now()
    });
  expect(page.choices).toHaveLength(0);
  expect(x.commands.execute).not.toHaveBeenCalled();
});
it('links a chosen task only after a grounded KB choice and an explicit relationship, with no provider mutation', async () => {
  const x = await setup(),
    candidate = {
      id: 'loop.sample',
      title: 'A commitment',
      basisRefs: ['journal:one']
    };
  x.context.linkCandidates = vi.fn(async () => ({
    available: true,
    items: [candidate],
    revision: 'owner-rev',
    nextCursor: null
  }));
  x.context.confirmLink = vi.fn(async () => ({
    applied: true
  }));
  const first = await x.flow.open({
    principal: x.principal(),
    flowType: 'create_link',
    asOf: x.now()
  });
  await x.deliver(first);
  const kb = await x.tap(first, 'This one');
  await x.deliver(kb.page);
  expect(kb.page.text).toContain('A commitment');
  const relation = await x.tap(kb.page, 'This one');
  expect(x.context.confirmLink).not.toHaveBeenCalled();
  await x.deliver(relation.page);
  expect((await x.tap(relation.page, 'A step toward it')).status).toBe('applied');
  expect(x.context.confirmLink).toHaveBeenCalledWith(expect.objectContaining({
    kbObjectId: 'loop.sample',
    relation: 'action_for',
    basisRefs: ['journal:one']
  }));
  expect(x.commands.execute).not.toHaveBeenCalled();
});
it('Later on confirmed current work suppresses the same native item after refresh and the next day', async () => {
  const x = await setup();
  await commit(x.state, 'active', [relevance('active')]);
  const selected = await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1
  });
  const page = await x.flow.prepareForMorning({
    username: 'sample',
    offerId: selected.offer.id,
    askDate: '2026-11-17'
  });
  await x.flow.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '300',
    asOf: x.now()
  });
  await x.tap(page, 'Later');
  x.advance(86400000);
  const gate = x.context.morningGate;
  x.context.morningGate = async () => ({
    ...(await gate()),
    askDate: '2026-11-18'
  });
  expect((await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-18',
    remainingUnits: 1
  })).offer).toBe(null);
});
it('withdrawn linked owner eligibility cannot expose the native title on Review', async () => {
  const x = await setup();
  const execute = x.context.execute;
  x.context.execute = async () => ({
    ...(await execute()),
    links: [{
      workRef: x.rows[0].ref,
      kbObjectId: 'loop.private'
    }],
    knowledgeEligibility: {
      'loop.private': {
        allowed: true
      }
    }
  });
  const selected = await x.flow.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1
  });
  const page = await x.flow.prepareForMorning({
    username: 'sample',
    offerId: selected.offer.id,
    askDate: '2026-11-17'
  });
  await x.flow.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '300',
    asOf: x.now()
  });
  x.context.execute = async () => ({
    ...(await execute()),
    links: [{
      workRef: x.rows[0].ref,
      kbObjectId: 'loop.private'
    }],
    knowledgeEligibility: {
      'loop.private': {
        allowed: false
      }
    }
  });
  const result = await x.tap(page, 'Review');
  expect(result.page).toBeUndefined();
  expect(result.status).toBe('denied');
});
it('manual review routes a task to its single assignee-scoped domain', async () => {
  const x = await setup();
  x.policy.domains.personal.assigneeIds = ['a'];
  x.policy.domains.other = {
    ...x.policy.domains.personal,
    assigneeIds: ['b']
  };
  x.rows[0].assigneeIds = ['a'];
  const page = await x.flow.open({
    principal: x.principal(),
    flowType: 'housekeeping',
    asOf: x.now()
  });
  await x.deliver(page);
  const result = await x.tap(page, 'This one');
  expect(result.status).toBe('page');
  expect(result.page.text).toContain('personal');
});
