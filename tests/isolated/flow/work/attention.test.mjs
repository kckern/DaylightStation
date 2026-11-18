import { it, expect, vi, afterEach } from 'vitest';
import moment from 'moment-timezone';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createWorkRuntime } from '../../../../__app_modules/personal/work/server/runtime.mjs';
import { AS_OF, todoTask, quiet } from '../../../_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const x of resources.splice(0)) {
    await x.runtime.dispose();
    fs.rmSync(x.root, {
      recursive: true,
      force: true
    });
  }
});
async function setup({
  proactive = false,
  items = 106
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-attention-flow-')),
    identity = {
      username: 'sample',
      senderId: '101',
      conversationId: 'telegram:b42_c101'
    },
    sent = [],
    writes = [];
  let ownerPorts = null,
    now = AS_OF,
    mode = 'knowledge',
    questionCount = 1,
    historyUnits = 0,
    pending = {
      available: true,
      due: false,
      ids: [],
      count: 0,
      revision: 'kb'
    };
  const tasks = Array.from({
    length: items
  }, (_, i) => todoTask({
    id: i ? 'task-' + i : 'sample-task',
    content: 'Legacy item ' + i
  }));
  const config = {
    work: {
      enabled: true,
      write: true,
      writer_env: 'fixture-prod',
      writer_host: 'fixture-writer',
      proactive,
      providers: {
        p: {
          type: 'todoist',
          accountId: 'personal',
          authScope: 'user',
          operations: ['read']
        }
      },
      domains: {
        personal: {
          provider: 'p',
          containerId: 'sample-project',
          role: 'tasks',
          autoComplete: 'never'
        }
      },
      users: {
        sample: {}
      },
      attention: {
        reviewWindows: [],
        housekeepingDomains: []
      }
    }
  };
  const history = async input => ownerPorts ? ownerPorts.history(input) : {
    available: true,
    deliveries: historyUnits ? [{
      id: 'kb:existing',
      day: moment.tz(now, 'America/Los_Angeles').format('YYYY-MM-DD'),
      channel: 'morning',
      status: 'delivered',
      questionUnits: historyUnits,
      deliveredAt: now - 1
    }] : [],
    reservations: [],
    unansweredInvitations: []
  };
  const runtime = createWorkRuntime({
    configuration: () => config,
    environment: 'fixture-prod',
    hostId: 'fixture-writer',
    rootForUser: u => path.join(root, u, 'work'),
    userTimezone: () => 'America/Los_Angeles',
    clock: () => now,
    identityForUser: () => identity,
    identityForSender: id => id === '101' ? identity : null,
    webhookSecret: 'secret',
    journalEvidence: {
      readForMessage: async () => null,
      readByRefs: async () => []
    },
    readCurrent: async () => ({
      accountId: 'personal',
      observedAt: now,
      coverage: {
        complete: true,
        scope: {
          accountId: 'personal',
          containerIds: ['sample-project'],
          assigneeIds: null
        },
        from: now - 86400000,
        to: now
      },
      tasks,
      containers: [{
        id: 'sample-project',
        name: 'Personal'
      }]
    }),
    readHistory: async () => ({}),
    readKnowledgeAttentionHistory: history,
    knowledgeAttentionGate: async input => ownerPorts ? ownerPorts.gate(input) : {
      mode,
      questionCount,
      askDate: moment.tz(now, 'America/Los_Angeles').format('YYYY-MM-DD')
    },
    knowledgeAttentionEligibility: async input => ownerPorts ? ownerPorts.eligibility(input) : {},
    knowledgeLinkCandidates: async input => ownerPorts?.link?.(input) ?? {
      available: false,
      items: [],
      revision: 'unavailable',
      nextCursor: null
    },
    pendingKnowledgeReview: async ({
      excludeIds = [],
      ...input
    }) => ownerPorts ? ownerPorts.pending({
      ...input,
      excludeIds
    }) : {
      ...pending,
      ids: pending.ids.filter(id => !excludeIds.includes(id)),
      count: pending.ids.filter(id => !excludeIds.includes(id)).length,
      revision: pending.revision + ':' + pending.ids.filter(id => !excludeIds.includes(id)).join(',')
    },
    httpClient: {
      requestRaw: async (method, url) => {
        if (method !== 'GET') {
          writes.push({
            method,
            url
          });
          throw Error('unexpected write');
        }
        const id = new URL(url).pathname.split('/').at(-1),
          row = tasks.find(t => t.id === id) ?? {
            id: 'sample-project',
            name: 'Personal'
          };
        return {
          ok: true,
          status: 200,
          headers: {},
          data: structuredClone(row)
        };
      }
    },
    getUserAuth: async () => ({
      api_key: 'fixture'
    }),
    send: async input => {
      sent.push(input);
      return {
        messageId: String(300 + sent.length)
      };
    },
    logger: quiet
  });
  await runtime.start();
  const x = {
    root,
    runtime
  };
  resources.push(x);
  const principal = (data = null, messageId = '99') => runtime.principal.capturePrincipal({
    event: {
      platform: 'telegram',
      type: data ? 'callback' : 'text',
      platformUserId: '101',
      conversationId: identity.conversationId,
      messageId,
      metadata: {
        senderId: '101',
        chatId: '101',
        chatType: 'private'
      },
      payload: {
        callbackId: String(Math.random()),
        callbackData: data
      }
    },
    webhookSecret: 'secret'
  });
  return {
    ...x,
    config,
    sent,
    writes,
    principal,
    now: () => now,
    setMode: v => {
      mode = v;
    },
    setQuestionCount: v => {
      questionCount = v;
    },
    setHistoryUnits: v => {
      historyUnits = v;
    },
    setOwnerPorts: p => {
      ownerPorts = p;
    },
    setPending: ids => {
      pending = {
        available: true,
        due: true,
        ids,
        count: ids.length,
        revision: 'kb'
      };
    },
    advance: ms => {
      now += ms;
    },
    state: () => yaml.load(fs.readFileSync(path.join(root, 'sample', 'work', 'state.yml'), 'utf8')).state
  };
}
it('first boot and a fresh collector timestamp never send or select an old backlog prompt', async () => {
  const x = await setup({
    proactive: true
  });
  expect(x.sent).toHaveLength(0);
  expect((await x.runtime.conversation.selectForMorning({
    username: 'sample',
    askDate: '2026-11-17',
    remainingUnits: 1,
    asOf: x.now()
  })).offer).toBe(null);
  expect(x.writes).toHaveLength(0);
});
it('manual bound housekeeping retires one item locally and duplicate callback does not touch the provider', async () => {
  const x = await setup(),
    page = await x.runtime.conversation.open({
      principal: x.principal(),
      flow: 'housekeeping',
      asOf: x.now()
    });
  expect(page.text.match(/Legacy item/g)).toHaveLength(3);
  await x.runtime.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '400',
    asOf: x.now()
  });
  const choose = page.choices[0][0].callback_data;
  const selected = await x.runtime.conversation.handleCallback({
    principal: x.principal(choose, '400'),
    callbackData: choose,
    botMessageId: '400',
    asOf: x.now()
  });
  const p = selected.page;
  await x.runtime.decisions.recordDelivery({
    username: 'sample',
    decisionId: p.decisionId,
    botMessageId: '401',
    asOf: x.now()
  });
  const token = p.choices.flat().find(b => b.text === 'Stop tracking').callback_data;
  const result = await x.runtime.conversation.handleCallback({
    principal: x.principal(token, '401'),
    callbackData: token,
    botMessageId: '401',
    asOf: x.now()
  });
  expect(result.status).toBe('applied');
  expect(Object.values(x.state().relevance).filter(r => r.state === 'retired')).toHaveLength(1);
  expect((await x.runtime.conversation.handleCallback({
    principal: x.principal(token, '401'),
    callbackData: token,
    botMessageId: '401',
    asOf: x.now()
  })).status).toBe('already_applied');
  expect(x.writes).toHaveLength(0);
});
it('five owner review proposals produce one acknowledged invitation and Later changes only local preferences', async () => {
  const x = await setup({
    proactive: true,
    items: 0
  });
  x.setPending(['one', 'two', 'three', 'four', 'five']);
  const result = await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  expect(result.status).toBe('sent');
  expect(x.sent).toHaveLength(1);
  expect(x.sent[0].text).toBe('Review 5 suggestions?');
  const token = x.sent[0].choices.flat().find(b => b.text === 'Later').callback_data;
  expect((await x.runtime.conversation.handleCallback({
    principal: x.principal(token, '301'),
    callbackData: token,
    botMessageId: '301',
    asOf: x.now()
  })).status).toBe('applied');
  expect(Object.values(x.state().reviewPreferences)).toHaveLength(5);
  expect(x.writes).toHaveLength(0);
  await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  expect(x.sent).toHaveLength(1);
});
it.each(['control', 'two', 'used'])('weekly invitations respect the %s gate and existing shared capacity', async reason => {
  const x = await setup({
    proactive: true,
    items: 0
  });
  x.setPending(['one']);
  if (reason === 'control') x.setMode('legacy');
  if (reason === 'two') x.setQuestionCount(2);
  if (reason === 'used') x.setHistoryUnits(2);
  await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  expect(x.sent).toHaveLength(0);
});
it('a copied or wrong-message workflow callback cannot change local tracking', async () => {
  const x = await setup({
      items: 1
    }),
    page = await x.runtime.conversation.open({
      principal: x.principal(),
      flow: 'housekeeping',
      asOf: x.now()
    });
  await x.runtime.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '400',
    asOf: x.now()
  });
  const token = page.choices[0][0].callback_data;
  expect((await x.runtime.conversation.handleCallback({
    principal: {
      ...x.principal(token, '400')
    },
    callbackData: token,
    botMessageId: '400',
    asOf: x.now()
  })).status).toBe('denied');
  expect((await x.runtime.conversation.handleCallback({
    principal: x.principal(token, '401'),
    callbackData: token,
    botMessageId: '400',
    asOf: x.now()
  })).status).toBe('denied');
  x.advance(86400001);
  expect((await x.runtime.conversation.handleCallback({
    principal: x.principal(token, '400'),
    callbackData: token,
    botMessageId: '400',
    asOf: x.now()
  })).status).toBe('denied');
  expect(Object.values(x.state().relevance)).toHaveLength(0);
});
import { KnowledgeQuestions } from '../../../../__app_modules/personal/lifelog/server/application/knowledge/KnowledgeQuestions.mjs';
import { memoryStore, evidenceSource, nextId, evidence as knowledgeEvidence } from '../../../../__app_modules/personal/lifelog/server/application/knowledge/fixtures.testHelpers.mjs';
import { loop } from '../../../../__app_modules/personal/lifelog/server/domain/knowledge/fixtures.testHelpers.mjs';
import { createKnowledgeCallbackTokens } from '../../../../__app_modules/personal/lifelog/server/adapters/knowledge/KnowledgeCallbackTokens.mjs';
import { GenerateMorningDebrief } from '../../../../__app_modules/personal/journalist/server/application/usecases/GenerateMorningDebrief.mjs';
import { createKnowledgePrincipalAuthority } from '../../../../__app_modules/personal/lifelog/server/adapters/knowledge/KnowledgePrincipalAuthority.mjs';
import { SendMorningDebrief } from '../../../../__app_modules/personal/journalist/server/application/usecases/SendMorningDebrief.mjs';
import { WorkCompanionAdapter } from '../../../../__app_modules/personal/journalist/server/adapters/WorkCompanionAdapter.mjs';
async function combined() {
  const x = await setup({
    proactive: true,
    items: 1
  });
  x.config.work.attention.reviewWindows = [{
    days: [1, 2, 3, 4, 5, 6, 7],
    start: '00:00',
    end: '23:59'
  }];
  x.config.work.attention.housekeepingDomains = ['personal'];
  const object = loop(),
    store = memoryStore({
      objects: {
        [object.id]: object
      },
      health: {
        available: true,
        conflicted: false,
        recovering: false,
        lastSweepAt: AS_OF
      },
      state: {
        pendingReviews: [],
        processedProposalIds: [],
        activationAt: AS_OF - 30 * 86400000
      }
    }),
    sources = evidenceSource([]),
    knowledgeAuthority = createKnowledgePrincipalAuthority({
      identityForSender: () => ({
        username: 'sample',
        senderId: '101',
        conversationId: 'telegram:b42_c101'
      }),
      webhookSecret: 'secret',
      clock: () => AS_OF
    }),
    questions = new KnowledgeQuestions({
      enabled: true,
      store,
      evidence: sources,
      tokens: createKnowledgeCallbackTokens(),
      verifyPrincipal: knowledgeAuthority.verify,
      identityForUser: () => ({
        username: 'sample',
        senderId: '101',
        conversationId: 'telegram:b42_c101'
      }),
      userTimezone: () => 'America/Los_Angeles',
      nextId: nextId(),
      activationDate: () => '2026-10-01',
      attentionBudget: x.runtime.attention
    });
  x.setOwnerPorts({
    history: i => questions.attentionHistory(i),
    gate: i => questions.attentionGate(i),
    eligibility: i => questions.attentionEligibility(i),
    pending: i => questions.pendingReview(i),
    link: i => questions.linkCandidates(i)
  });
  const source = {
      selectForMorning: i => questions.selectForMorning(i),
      prepareDelivery: i => questions.prepareDelivery(i),
      dispatchDelivery: i => questions.dispatchDelivery(i),
      recordDelivery: i => questions.recordDelivery(i),
      recordDeliveryFailure: i => questions.recordDeliveryFailure(i)
    },
    work = new WorkCompanionAdapter({
      runtime: x.runtime,
      clock: x.now,
      send: async () => {
        throw Error('unexpected standalone send');
      }
    }),
    send = vi.fn(async () => ({
      messageId: '700'
    })),
    archive = {
      appendDebrief: vi.fn(async () => {})
    },
    generation = new GenerateMorningDebrief({
      lifelogAggregator: {
        aggregate: async () => ({
          _meta: {
            date: '2026-11-16',
            hasEnoughData: true,
            sources: ['calendar']
          },
          events: [],
          summaryText: 'Recorded activity.'
        })
      },
      aiGateway: {
        chat: vi.fn()
      },
      debriefRepository: {
        getDebriefByDate: async () => ({
          date: '2026-11-16',
          summary: 'Recorded activity.',
          headline: null,
          summaries: []
        })
      },
      followUpSource: source,
      workCompanion: work,
      clock: x.now,
      userTimezone: () => 'America/Los_Angeles',
      logger: quiet
    }),
    sender = new SendMorningDebrief({
      messagingGateway: {
        sendMessage: send
      },
      followUpSource: source,
      workCompanion: work,
      debriefRepository: archive,
      clock: x.now,
      logger: quiet
    });
  const debrief = await generation.execute({
    username: 'sample',
    date: '2026-11-16',
    askDate: '2026-11-17',
    asOf: AS_OF
  });
  return {
    ...x,
    store,
    sources,
    questions,
    knowledgeAuthority,
    send,
    archive,
    sender,
    debrief
  };
}
it('shares one real KB question and one Work invitation in one message and coalesces both owner receipts', async () => {
  const x = await combined();
  expect(x.debrief.workOffer).toBeTruthy();
  expect(x.debrief.knowledgeSelection.questions).toHaveLength(1);
  const input = {
    username: 'sample',
    conversationId: 'telegram:b42_c101',
    debrief: x.debrief
  };
  await x.sender.execute(input);
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.send.mock.calls[0][1].match(/\?/g)).toHaveLength(2);
  const h = await x.runtime.attention.history({
    username: 'sample',
    asOf: AS_OF
  });
  expect(h.records.filter(r => r.status === 'delivered').reduce((n, r) => n + r.questionUnits, 0)).toBe(2);
  expect((await x.store.read({
    username: 'sample'
  })).asks).toHaveLength(1);
  expect(x.archive.appendDebrief.mock.calls[0][0].summary).not.toContain('Review one older work item?');
  expect((await x.sender.execute(input)).suppressed).toBe(true);
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.writes).toHaveLength(0);
});
it('does not repeat the combined send when KB ACK succeeds but the Work receipt fails', async () => {
  const x = await combined();
  x.runtime.conversation.recordDelivery = async () => {
    throw Error('work ACK disk failure');
  };
  const input = {
    username: 'sample',
    conversationId: 'telegram:b42_c101',
    debrief: x.debrief
  };
  await expect(x.sender.execute(input)).rejects.toThrow('work ACK disk failure');
  expect(x.send).toHaveBeenCalledTimes(1);
  expect((await x.sender.execute(input)).suppressed).toBe(true);
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(Object.values(x.state().attention).filter(r => r.status === 'quarantined')).toHaveLength(1);
});
it('binds a real scoped task to a grounded KB commitment only through the explicit relationship controls', async () => {
  const x = await combined();
  x.sources.rows.push(knowledgeEvidence({
    ref: 'journalist:msg:source-old',
    sourceId: 'source-old',
    content: 'I will wait for a reply',
    at: AS_OF - 86400000,
    localDate: '2026-11-16'
  }));
  const click = async (page, label, messageId) => {
    await x.runtime.decisions.recordDelivery({
      username: 'sample',
      decisionId: page.decisionId,
      botMessageId: messageId,
      asOf: AS_OF
    });
    const token = page.choices.flat().find(b => b.text === label).callback_data;
    const principal = x.principal(token, messageId);
    const knowledgePrincipal = x.knowledgeAuthority.attest({
      webhookSecret: 'secret',
      event: {
        platform: 'telegram',
        platformUserId: '101',
        conversationId: principal.conversationId,
        type: principal.kind,
        messageId,
        metadata: {
          senderId: '101',
          chatId: '101',
          chatType: 'private'
        },
        payload: {
          callbackData: token,
          callbackId: principal.receiptId.split(':callback:')[1]
        }
      }
    });
    x.runtime.conversation.bindKnowledgePrincipal({
      principal,
      knowledgePrincipal
    });
    return x.runtime.conversation.handleCallback({
      principal,
      callbackData: token,
      botMessageId: messageId,
      asOf: AS_OF
    });
  };
  const task = await x.runtime.conversation.open({
      principal: x.principal(),
      flow: 'create_link',
      asOf: AS_OF
    }),
    kb = await click(task, 'This one', '810'),
    relation = await click(kb.page, 'This one', '811');
  expect(Object.keys(x.state().links)).toHaveLength(0);
  expect((await click(relation.page, 'Same commitment', '812')).status).toBe('applied');
  expect(Object.values(x.state().links)[0]).toMatchObject({
    kbObjectId: 'loop.application-reply',
    relation: 'same_commitment'
  });
  expect((await x.store.read({
    username: 'sample'
  })).objects['loop.application-reply'].status).toBe('open');
  expect(x.writes).toHaveLength(0);
});
it('retains existing Work accounting across read-only and disabled runtime restarts', async () => {
  const x = await setup({
    proactive: true,
    items: 1
  });
  x.setPending(['review-only']);
  await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  expect(x.sent).toHaveLength(1);
  x.config.work.write = false;
  const req = {
    owner: 'knowledge',
    username: 'sample',
    decisionId: 'new-kb',
    channel: 'morning',
    flowType: 'morning',
    questionUnits: 2,
    expiresAt: x.now() + 86400000
  };
  expect((await x.runtime.attention.reserve(req)).allowed).toBe(false);
  x.config.work.enabled = false;
  const restarted = createWorkRuntime({
    configuration: x.config,
    rootForUser: username => path.join(x.root, username, 'work'),
    userTimezone: () => 'America/Los_Angeles',
    clock: x.now
  });
  expect((await restarted.attention.reserve(req)).allowed).toBe(false);
  await restarted.dispose();
});
it('a genuine weekly Review can resume its read-only handoff on another tap without a second invitation', async () => {
  const x = await setup({
    proactive: true,
    items: 1
  });
  x.setPending(['review-1']);
  await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  const token = x.sent[0].choices[0][0].callback_data;
  const tap = () => x.runtime.conversation.handleCallback({
    principal: x.principal(token, '301'),
    callbackData: token,
    botMessageId: '301',
    asOf: x.now()
  });
  expect((await tap()).status).toBe('knowledge_review');
  expect((await tap()).status).toBe('knowledge_review');
  const other = x.sent[0].choices.flat().find(b => b.text === 'Later').callback_data;
  expect((await x.runtime.conversation.handleCallback({
    principal: x.principal(other, '301'),
    callbackData: other,
    botMessageId: '301',
    asOf: x.now()
  })).status).not.toBe('knowledge_review');
  x.setPending(['review-2']);
  await x.runtime.conversation.deliverWeeklyReview({
    username: 'sample',
    asOf: x.now()
  });
  expect(x.sent).toHaveLength(1);
});
it('a morning prepared on one day cannot reach transport on another day', async () => {
  const x = await combined();
  const prepare = x.questions.prepareDelivery.bind(x.questions);
  x.questions.prepareDelivery = async input => {
    const d = await prepare(input);
    x.advance(86400000);
    return d;
  };
  await expect(x.sender.execute({
    username: 'sample',
    conversationId: 'telegram:b42_c101',
    debrief: x.debrief
  })).rejects.toThrow('KNOWLEDGE_DISPATCH_DENIED');
  expect(x.send).not.toHaveBeenCalled();
});
