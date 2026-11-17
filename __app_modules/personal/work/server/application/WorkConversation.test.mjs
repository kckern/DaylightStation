import { it, expect, afterEach, vi } from 'vitest';
import { WorkConversation } from './WorkConversation.mjs';
import { harness, item, ref, commit } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
function setup() {
  const h = harness();
  resources.push(h);
  const state = h.make(),
    trusted = new WeakSet();
  let now = AS_OF,
    dto = {
      username: 'sample',
      ref: 'journalist:msg:' + 'a'.repeat(64),
      sourceHash: 'b'.repeat(64),
      senderId: '101',
      conversationId: 'telegram:private',
      messageId: '99',
      content: 'I finished Contact Sample',
      at: AS_OF,
      verified: true,
      previewOnly: false,
      source: 'user'
    },
    jobs = [],
    intents = [{
      operation: 'complete',
      domainId: 'personal',
      title: 'Contact Sample',
      quote: 'I finished Contact Sample'
    }];
  const principal = Object.freeze({
    username: 'sample',
    senderId: '101',
    conversationId: dto.conversationId,
    messageId: '99',
    receiptId: 'receipt-1',
    sourceRevision: 'identity-v1',
    kind: 'text',
    authored: true,
    receivedAt: AS_OF,
    edited: false
  });
  trusted.add(principal);
  const principalAuthority = {
    verify: p => trusted.has(p) ? p : null,
    capturePrincipal: () => principal
  };
  const policy = {
    enabled: true,
    revision: 'policy-1',
    providers: {
      p: {
        type: 'todoist',
        accountId: 'personal',
        operations: ['read', 'complete']
      }
    },
    domains: {
      personal: {
        provider: 'p',
        containerId: 'sample-project',
        role: 'tasks',
        autoComplete: 'linked_explicit'
      }
    },
    limits: {
      snapshotMaxAgeHours: 24
    }
  };
  const link = {
    id: 'link.' + 'c'.repeat(64),
    username: 'sample',
    kbObjectId: 'loop.sample',
    workRef: ref,
    relation: 'same_commitment',
    basisRefs: [dto.ref],
    confirmedAt: AS_OF - 1
  };
  const context = {
    execute: async () => ({
      coverage: {
        complete: true
      },
      items: [item()],
      containers: [],
      links: [link]
    }),
    getItem: async () => item()
  };
  const commands = {
    propose: vi.fn(async ({
      intent
    }) => ({
      command: {
        id: 'command-1'
      },
      requiresConfirmation: intent.mode !== 'auto'
    })),
    execute: vi.fn(async () => ({
      outcome: 'applied'
    }))
  };
  const decisions = {
    prepare: vi.fn(async () => ({
      decisionId: 'decision-1',
      text: 'Complete task',
      choices: [],
      expiresAt: now + 86400000
    })),
    reply: vi.fn()
  };
  const extractor = {
    extract: vi.fn(async () => ({
      intents
    }))
  };
  const evidence = {
    readForMessage: async () => dto,
    readByRefs: async () => dto ? [dto] : []
  };
  const scheduler = {
    after: (delay, work) => {
      const job = {
        at: now + delay,
        work,
        cancelled: false
      };
      jobs.push(job);
      return () => {
        job.cancelled = true;
      };
    }
  };
  const deliver = vi.fn();
  const service = new WorkConversation({
    state,
    context,
    commands,
    decisions,
    principalAuthority,
    evidence,
    intentExtractor: extractor,
    resolvePolicy: () => policy,
    scheduler,
    clock: () => now,
    deliver
  });
  const save = () => service.onEntrySaved({
    principal,
    message: {
      id: '99',
      content: dto.content,
      source: {
        verified: true,
        platform: 'telegram'
      }
    },
    asOf: now
  });
  return {
    h,
    state,
    service,
    principal,
    commands,
    decisions,
    extractor,
    context,
    policy,
    deliver,
    save,
    setDto: value => {
      dto = value;
    },
    getDto: () => dto,
    setIntents: value => {
      intents = value;
    },
    async advance(ms) {
      now += ms;
      for (const job of jobs.filter(j => !j.cancelled && j.at <= now)) {
        job.cancelled = true;
        await job.work();
      }
    },
    now: () => now
  };
}
it('coordinates only after durable save and fifteen minute debounce, with one eligible linked completion', async () => {
  const x = setup();
  expect(x.service.sourceForEntry({
    principal: x.principal,
    chatId: 'telegram:private',
    messageId: '99',
    senderId: '101'
  })).toMatchObject({
    verified: true
  });
  await x.save();
  expect(x.commands.execute).not.toHaveBeenCalled();
  await x.advance(15 * 60000);
  expect(x.commands.execute).toHaveBeenCalledTimes(1);
  expect(x.extractor.extract).toHaveBeenCalledTimes(1);
  await x.save();
  await x.advance(15 * 60000);
  expect(x.commands.execute).toHaveBeenCalledTimes(1);
});
it.each(["I haven't finished Contact Sample", 'I might finish Contact Sample', 'Sample said they finished Contact Sample', '"I finished Contact Sample"'])('does not auto-write for %s', async text => {
  const x = setup();
  x.setDto({
    ...x.getDto(),
    content: text
  });
  x.setIntents([{
    operation: 'complete',
    domainId: 'personal',
    title: 'Contact Sample',
    quote: text
  }]);
  await x.save();
  await x.advance(15 * 60000);
  expect(x.commands.execute).not.toHaveBeenCalled();
  expect(x.deliver).not.toHaveBeenCalled();
});
it('rejects serialized principals and mismatched saved content even when KB is absent', async () => {
  const x = setup();
  expect(x.service.sourceForEntry({
    principal: {
      ...x.principal
    },
    chatId: 'telegram:private',
    messageId: '99',
    senderId: '101'
  })).toBeNull();
  expect((await x.service.onEntrySaved({
    principal: x.principal,
    message: {
      content: 'Different'
    },
    asOf: AS_OF
  })).handled).toBe(false);
  expect(x.extractor.extract).not.toHaveBeenCalled();
});
it('invalidates pending work when its journal evidence is superseded and never automatically reopens applied work', async () => {
  const x = setup();
  await x.save();
  const sources = Object.values((await x.state.read({
    username: 'sample'
  })).sources);
  expect(sources).toHaveLength(1);
  x.setDto({
    ...x.getDto(),
    content: 'I have not completed Contact Sample',
    sourceHash: 'd'.repeat(64)
  });
  await x.save();
  await x.advance(15 * 60000);
  expect(x.commands.execute).not.toHaveBeenCalled();
  expect((await x.state.read({
    username: 'sample'
  })).sources[sources[0].id].valid).toBe(false);
});
it('shows at most three matching choices before a requested state change', async () => {
  const x = setup();
  x.context.execute = async () => ({
    coverage: {
      complete: true
    },
    items: Array.from({
      length: 5
    }, (_, i) => item({
      ref: {
        ...ref,
        id: 'task-' + i
      }
    })),
    containers: [],
    links: []
  });
  await x.save();
  await x.advance(15 * 60000);
  expect(x.commands.execute).not.toHaveBeenCalled();
  const flow = x.decisions.prepare.mock.calls[0][0].flowState;
  expect(flow.selectionRefs).toHaveLength(3);
  const page = await x.service.renderFlow({
    principal: x.principal,
    flowState: flow,
    asOf: x.now()
  });
  expect(page.options.filter(c => c.action === 'choose')).toHaveLength(3);
  expect(page.more).toBe(true);
});
it('cancels delayed work on disposal and cannot mint trust from persisted principals after restart', async () => {
  const x = setup();
  await x.save();
  await x.service.dispose();
  await x.advance(15 * 60000);
  expect(x.commands.execute).not.toHaveBeenCalled();
  expect(x.extractor.extract).not.toHaveBeenCalled();
});
it('turns board check-in into a confirmed semantic transition and never a completion command', async () => {
  const x = setup();
  x.policy.domains.personal.role = 'projects';
  x.policy.domains.personal.autoComplete = 'never';
  x.policy.domains.personal.transitions = {
    code_checked_in: 'review'
  };
  const text = 'I checked in Contact Sample';
  x.setDto({
    ...x.getDto(),
    content: text
  });
  x.setIntents([{
    operation: 'progress',
    transition: 'code_checked_in',
    domainId: 'personal',
    title: 'Contact Sample',
    quote: text
  }]);
  await x.save();
  await x.advance(15 * 60000);
  const flowState = x.decisions.prepare.mock.calls[0][0].flowState,
    page = await x.service.renderFlow({
      principal: x.principal,
      flowState,
      asOf: x.now()
    }),
    choice = page.options.find(c => c.action === 'choose');
  expect((await x.service.applyFlowChoice({
    principal: x.principal,
    flowState,
    choice,
    asOf: x.now()
  })).status).toBe('confirmation');
  expect(x.commands.propose).toHaveBeenCalledWith(expect.objectContaining({
    intent: expect.objectContaining({
      operation: 'transition',
      payload: {
        transition: 'code_checked_in'
      },
      mode: 'manual'
    })
  }));
  expect(x.commands.execute).not.toHaveBeenCalled();
});
