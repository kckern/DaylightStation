import { it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { createWorkRuntime } from '../../../../__app_modules/personal/work/server/runtime.mjs';
import { createAuthoredJournalEvidence } from '../../../../__app_modules/personal/lifelog/server/knowledge-runtime.mjs';
import { YamlJournalEntryRepository } from '../../../../__app_modules/personal/journalist/server/adapters/persistence/YamlJournalEntryRepository.mjs';
import { WorkCompanionAdapter } from '../../../../__app_modules/personal/journalist/server/adapters/WorkCompanionAdapter.mjs';
import { workHash } from '../../../../__app_modules/personal/work/server/domain/workState.mjs';
import { AS_OF, todoTask, quiet } from '../../../_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) {
    await h.runtime.dispose();
    fs.rmSync(h.root, {
      recursive: true,
      force: true
    });
  }
});
async function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-two-way-'));
  let now = AS_OF,
    native = todoTask({
      due: null,
      completed_count: 0
    }),
    cached = structuredClone(native),
    observedAt = AS_OF,
    history = {},
    nativeHistory = {},
    hook = null,
    authHook = null,
    failWrite = false;
  const jobs = [],
    writes = [],
    sent = [],
    models = vi.fn(async () => ({
      intents: []
    })),
    identity = {
      username: 'sample',
      senderId: '101',
      conversationId: 'telegram:b42_c101'
    },
    secret = 'fixture-secret',
    documents = new Map();
  const dataService = {
    user: {
      read: (key, user) => structuredClone(documents.get(user + ':' + key) ?? null),
      write: (key, value, user) => {
        documents.set(user + ':' + key, structuredClone(value));
        return true;
      }
    }
  };
  const journal = new YamlJournalEntryRepository({
    dataService,
    userResolver: {
      resolveUser: () => 'sample'
    },
    configService: {
      getUserTimezone: () => 'America/Los_Angeles'
    },
    logger: quiet
  });
  const evidence = createAuthoredJournalEvidence({
    loadJournal: async user => dataService.user.read('lifelog/journalist/messages', user),
    identityForUser: () => identity,
    timezoneForUser: () => 'America/Los_Angeles',
    logger: quiet
  });
  const config = {
    work: {
      enabled: true,
      write: true,
      writer_env: 'fixture-prod',
      writer_host: 'fixture-writer',
      providerWrites: true,
      providers: {
        p: {
          type: 'todoist',
          accountId: 'personal',
          authScope: 'user',
          operations: ['read', 'complete', 'reopen', 'create_task', 'create_container']
        }
      },
      domains: {
        personal: {
          provider: 'p',
          containerId: 'sample-project',
          creationParentId: 'sample-project',
          role: 'tasks',
          autoComplete: 'linked_explicit'
        }
      },
      users: {
        sample: {}
      }
    }
  };
  const projects = new Map([['sample-project', {
    id: 'sample-project',
    name: 'Personal errands',
    parent_id: null
  }]]);
  const httpClient = {
    requestRaw: vi.fn(async (method, url, options) => {
      const pathname = new URL(url).pathname;
      if (method === 'GET') {
        const id = pathname.split('/').at(-1),
          row = pathname.includes('/projects/') ? projects.get(id) : native.id === id ? native : null;
        return {
          ok: !!row,
          status: row ? 200 : 404,
          headers: {},
          data: row ? structuredClone(row) : null
        };
      }
      writes.push({
        method,
        url,
        body: options.body
      });
      let data = {};
      if (pathname === '/api/v1/projects') {
        data = {
          id: 'created-project',
          name: options.body.name,
          parent_id: options.body.parent_id
        };
        projects.set(data.id, data);
      } else if (pathname === '/api/v1/tasks') {
        native = todoTask({
          id: 'created-task',
          content: options.body.content,
          description: options.body.description ?? '',
          project_id: options.body.project_id,
          added_at: new Date(now).toISOString(),
          due: null,
          completed_count: 0,
          responsible_uid: options.body.assignee_id ?? null
        });
        data = structuredClone(native);
      } else if (pathname.endsWith('/close')) {
        native = {
          ...native,
          checked: true,
          completed_count: native.completed_count + 1,
          completed_at: new Date(now).toISOString()
        };
        nativeHistory = {
          '2026-11-17': [{
            id: native.id,
            accountId: 'personal',
            projectId: 'sample-project',
            content: native.content,
            action: 'completed',
            occurredAt: now,
            occurrenceId: String(now),
            actorId: 'native-owner',
            occurredAtEstimated: false
          }]
        };
      } else if (pathname.endsWith('/reopen')) native = {
        ...native,
        checked: false,
        completed_count: Math.max(0, native.completed_count - 1),
        completed_at: null
      };
      return {
        ok: !failWrite,
        status: failWrite ? 503 : 200,
        headers: {},
        data
      };
    })
  };
  const gateway = {
    model: 'fixture',
    scoped() {
      return {
        chatStructured: models
      };
    }
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
  const runtime = createWorkRuntime({
    configuration: () => config,
    environment: 'fixture-prod',
    hostId: 'fixture-writer',
    rootForUser: u => path.join(root, u, 'work'),
    activityRootForUser: u => path.join(root, u, 'lifelog'),
    userTimezone: () => 'America/Los_Angeles',
    clock: () => now,
    scheduler,
    identityForSender: id => id === '101' ? identity : null,
    webhookSecret: secret,
    journalEvidence: evidence,
    gateway,
    httpClient,
    getUserAuth: async () => {
      if (authHook) await authHook();
      return {
        api_key: 'fixture-token'
      };
    },
    getHouseholdAuth: () => null,
    readCurrent: async () => ({
      accountId: 'personal',
      observedAt,
      coverage: {
        complete: true,
        from: AS_OF - 86400000,
        to: observedAt,
        scope: {
          accountId: 'personal',
          containerIds: ['sample-project'],
          assigneeIds: null
        }
      },
      tasks: cached ? [cached] : [],
      containers: [{
        id: 'sample-project',
        name: 'Personal errands'
      }]
    }),
    readHistory: async () => history,
    harvesterService: {
      onResult: fn => {
        hook = fn;
        return () => {
          hook = null, authHook = null, failWrite = false;
        };
      }
    },
    send: async input => {
      sent.push({
        ...input,
        messageId: String(300 + sent.length)
      });
      return {
        messageId: sent.at(-1).messageId
      };
    },
    logger: quiet
  });
  const h = {
    root,
    runtime
  };
  resources.push(h);
  await runtime.start();
  const event = (messageId = '99', type = 'text', callbackData = null, edited = false, replyToMessageId = null) => ({
    platform: 'telegram',
    type,
    platformUserId: '101',
    conversationId: identity.conversationId,
    messageId,
    metadata: {
      senderId: '101',
      chatId: '101',
      chatType: 'private',
      replyToMessageId,
      ...(edited ? {
        edited: true,
        editDate: Math.floor(now / 1000),
        updateId: 1000 + sent.length
      } : {})
    },
    payload: {
      callbackId: 'callback-' + sent.length + '-' + messageId,
      callbackData
    }
  });
  const capture = (messageId, type, callbackData, edited = false, replyToMessageId = null) => runtime.principal.capturePrincipal({
    event: event(messageId, type, callbackData, edited, replyToMessageId),
    webhookSecret: secret
  });
  const adapter = () => new WorkCompanionAdapter({
    runtime,
    clock: () => now,
    send: async input => {
      sent.push({
        ...input,
        messageId: String(200 + sent.length)
      });
      return {
        messageId: sent.at(-1).messageId
      };
    }
  });
  const save = async (text = 'I finished Contact Sample', {
    edited = false,
    messageId = '99',
    replyToMessageId = null
  } = {}) => {
    const principal = capture(messageId, 'text', null, edited, replyToMessageId),
      source = runtime.conversation.sourceForEntry({
        principal,
        chatId: identity.conversationId,
        messageId,
        senderId: '101'
      });
    const message = await journal.save({
      id: messageId,
      role: 'user',
      content: text,
      senderId: '101',
      timestamp: new Date(now).toISOString(),
      source
    }, identity.conversationId);
    return {
      principal,
      message
    };
  };
  return {
    ...h,
    config,
    writes,
    sent,
    models,
    capture,
    adapter,
    save,
    documents,
    evidence,
    async advance(ms) {
      now += ms;
      for (const job of jobs.filter(j => !j.cancelled && j.at <= now)) {
        job.cancelled = true;
        await job.work();
      }
    },
    async harvest() {
      observedAt = now;
      cached = native.checked ? null : structuredClone(native);
      history = structuredClone(nativeHistory);
      await hook?.({
        username: 'sample',
        serviceId: 'todoist',
        result: {
          status: 'success',
          coverage: {
            complete: true
          }
        }
      });
    },
    readState: () => yaml.load(fs.readFileSync(path.join(root, 'sample', 'work', 'state.yml'), 'utf8')),
    setAuthHook: fn => {
      authHook = fn;
    },
    failWrites: () => {
      failWrite = true;
    },
    changeNative: patch => {
      native = {
        ...native,
        ...patch
      };
    },
    now: () => now
  };
}
it('saves verified journal evidence with KB disabled, completes one linked task and projects its returning occurrence once', async () => {
  const x = await setup();
  expect(x.runtime.conversation).toBeTruthy();
  const saved = await x.save();
  const context = await x.runtime.context.execute({
    username: 'sample',
    asOf: x.now()
  });
  await x.runtime.context.confirmLink({
    principal: saved.principal,
    kbObjectId: 'loop.contact-sample',
    workRef: context.items[0].ref,
    relation: 'same_commitment',
    basisRefs: [(await x.evidence.readForMessage({
      username: 'sample',
      conversationId: 'telegram:b42_c101',
      messageId: '99'
    })).ref],
    asOf: x.now()
  });
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(1);
  expect(x.models).not.toHaveBeenCalled();
  await x.harvest();
  await x.harvest();
  const events = await x.runtime.activities.read({
    username: 'sample',
    from: AS_OF,
    to: x.now() + 1
  });
  expect(events.filter(e => e.type === 'completed')).toHaveLength(1);
  const messages = x.documents.get('sample:lifelog/journalist/messages').messages;
  expect(messages).toHaveLength(1);
  expect(messages[0].content).toBe('I finished Contact Sample');
});
it('requires selection and a delivered named confirmation for an unbound keyboard action', async () => {
  const x = await setup(),
    adapter = x.adapter(),
    p = x.capture('98', 'text');
  await adapter.open({
    principal: p,
    flow: 'tasks'
  });
  expect(x.writes).toHaveLength(0);
  const select = x.sent.at(-1),
    token = select.choices[0][0].callback_data;
  await adapter.handleCallback({
    principal: x.capture(select.messageId, 'callback', token),
    callbackData: token,
    botMessageId: select.messageId
  });
  expect(x.writes).toHaveLength(0);
  const confirm = x.sent.at(-1);
  expect(confirm.choices[0][0].text).toBe('Complete task');
  const approved = confirm.choices[0][0].callback_data,
    callback = x.capture(confirm.messageId, 'callback', approved);
  await adapter.handleCallback({
    principal: callback,
    callbackData: approved,
    botMessageId: confirm.messageId
  });
  await adapter.handleCallback({
    principal: callback,
    callbackData: approved,
    botMessageId: confirm.messageId
  });
  expect(x.writes).toHaveLength(1);
});
it('supersedes an old journal source before dispatch and does not automatically reopen a completed provider task', async () => {
  const x = await setup();
  const original = await x.save();
  await x.runtime.conversation.onEntrySaved({
    ...original,
    asOf: x.now()
  });
  await x.advance(1000);
  const correction = await x.save('I have not finished Contact Sample', {
    edited: true
  });
  await x.runtime.conversation.onEntrySaved({
    ...correction,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it('offers an explicit correction after an applied journal completion is edited, without automatic reopen', async () => {
  const x = await setup(),
    original = await x.save();
  const context = await x.runtime.context.execute({
    username: 'sample',
    asOf: x.now()
  });
  await x.runtime.context.confirmLink({
    principal: original.principal,
    kbObjectId: 'loop.contact-sample',
    workRef: context.items[0].ref,
    relation: 'same_commitment',
    basisRefs: [],
    asOf: x.now()
  });
  await x.runtime.conversation.onEntrySaved({
    ...original,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(1);
  const correction = await x.save('I have not finished Contact Sample', {
    edited: true
  });
  const result = await x.runtime.conversation.onEntrySaved({
    ...correction,
    asOf: x.now()
  });
  expect(result.pendingDecision).toBeTruthy();
  expect(result.pendingDecision.choices.flat().map(choice => choice.text)).toContain('Reopen task');
  expect(x.writes).toHaveLength(1);
});
it('cancels a queued source-bound command when its journal entry is edited before confirmation', async () => {
  const x = await setup(),
    saved = await x.save();
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  const adapter = x.adapter(),
    select = x.sent.at(-1),
    choose = select.choices[0][0].callback_data;
  await adapter.handleCallback({
    principal: x.capture(select.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: select.messageId
  });
  const confirm = x.sent.at(-1),
    token = confirm.choices[0][0].callback_data;
  const edit = await x.save('I have not finished Contact Sample', {
    edited: true
  });
  await x.runtime.conversation.onEntrySaved({
    ...edit,
    asOf: x.now()
  });
  expect((await adapter.handleCallback({
    principal: x.capture(confirm.messageId, 'callback', token),
    callbackData: token,
    botMessageId: confirm.messageId
  })).status).toBe('denied');
  expect(x.writes).toHaveLength(0);
});
import { MaintainKnowledgeBase } from '../../../../__app_modules/personal/lifelog/server/application/knowledge/MaintainKnowledgeBase.mjs';
import { memoryStore, evidenceSource, evidence as knowledgeEvidence, nextId } from '../../../../__app_modules/personal/lifelog/server/application/knowledge/fixtures.testHelpers.mjs';
it('enforces four combined live KB and Work model attempts through the composed budget', async () => {
  const x = await setup(),
    store = memoryStore(),
    sources = evidenceSource([]),
    extractor = {
      extract: vi.fn(async () => ({
        proposals: [],
        modelVersion: 'fixture'
      }))
    };
  const maintenance = new MaintainKnowledgeBase({
    enabled: true,
    store,
    evidence: sources,
    extractor,
    clock: x.now,
    userTimezone: () => 'America/Los_Angeles',
    nextId: nextId(),
    callBudget: x.runtime.callBudget,
    logger: quiet
  });
  for (let n = 0; n < 3; n++) {
    sources.rows.splice(0, sources.rows.length, knowledgeEvidence({
      sourceId: 'shared-' + n,
      ref: 'journalist:msg:shared-' + n,
      at: x.now(),
      localDate: '2026-11-17',
      content: 'I will follow up on the plan. '.repeat(10)
    }));
    expect((await maintenance.execute({
      username: 'sample',
      trigger: 'post-entry',
      asOf: x.now()
    })).status).toBe('completed');
  }
  const saved = await x.save('I made progress on Contact Sample');
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.models).toHaveBeenCalledTimes(1);
  expect(extractor.extract).toHaveBeenCalledTimes(3);
  expect((await x.runtime.callBudget.reserve({
    username: 'sample',
    receiptId: 'fifth-rank',
    scope: 'workflow-rank',
    asOf: x.now()
  })).allowed).toBe(false);
  sources.rows.splice(0, sources.rows.length, knowledgeEvidence({
    sourceId: 'shared-last',
    ref: 'journalist:msg:shared-last',
    at: x.now(),
    localDate: '2026-11-17',
    content: 'Another explicit commitment. '.repeat(10)
  }));
  expect((await maintenance.execute({
    username: 'sample',
    trigger: 'post-entry',
    asOf: x.now()
  })).status).toBe('budget_exhausted');
  expect(extractor.extract).toHaveBeenCalledTimes(3);
});
it('does not automatically act on an older completion when a later saved entry mentions the same task', async () => {
  const x = await setup(),
    first = await x.save();
  const context = await x.runtime.context.execute({
    username: 'sample',
    asOf: x.now()
  });
  await x.runtime.context.confirmLink({
    principal: first.principal,
    kbObjectId: 'loop.contact-sample',
    workRef: context.items[0].ref,
    relation: 'same_commitment',
    basisRefs: [],
    asOf: x.now()
  });
  await x.runtime.conversation.onEntrySaved({
    ...first,
    asOf: x.now()
  });
  await x.advance(1000);
  const correction = await x.save('I have not finished Contact Sample', {
    messageId: '100'
  });
  await x.runtime.conversation.onEntrySaved({
    ...correction,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it.each([['create_task', 'Create task Pay bill', 'Pay bill', '/api/v1/tasks'], ['create_container', 'Create project Holiday', 'Holiday', '/api/v1/projects']])('processes an explicit %s request promptly and names the destination before writing', async (operation, text, title, expectedPath) => {
  const x = await setup();
  x.models.mockResolvedValue({
    intents: [{
      operation,
      domainId: 'personal',
      title,
      quote: text
    }]
  });
  const saved = await x.save(text);
  const result = await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  expect(x.models).toHaveBeenCalledTimes(1);
  expect(result.suppressFollowUp).toBe(true);
  expect(x.writes).toHaveLength(0);
  const adapter = x.adapter(),
    selection = x.sent.at(-1),
    choose = selection.choices[0][0].callback_data;
  await adapter.handleCallback({
    principal: x.capture(selection.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: selection.messageId
  });
  const page = x.sent.at(-1);
  expect(page.text).toContain(title);
  expect(page.text).toContain('Personal errands');
  const token = page.choices[0][0].callback_data;
  const confirmed = await adapter.handleCallback({
    principal: x.capture(page.messageId, 'callback', token),
    callbackData: token,
    botMessageId: page.messageId
  });
  expect(confirmed.status).toBe('applied');
  expect(x.writes).toHaveLength(1);
  expect(new URL(x.writes[0].url).pathname).toBe(expectedPath);
});
async function linkSaved(x, saved) {
  const c = await x.runtime.context.execute({
    username: 'sample',
    asOf: x.now()
  });
  const e = await x.evidence.readForMessage({
    username: 'sample',
    conversationId: 'telegram:b42_c101',
    messageId: saved.principal.messageId
  });
  await x.runtime.context.confirmLink({
    principal: saved.principal,
    kbObjectId: 'loop.contact-sample',
    workRef: c.items[0].ref,
    relation: 'same_commitment',
    basisRefs: [e.ref],
    asOf: x.now()
  });
  return {
    item: c.items[0],
    receipt: 'source.' + workHash(['sample', e.ref, e.sourceHash])
  };
}
it('rejects invented automatic wording against a genuine unrelated journal receipt', async () => {
  const x = await setup(),
    saved = await x.save('I enjoyed the weather');
  const {
    item,
    receipt
  } = await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await expect(x.runtime.commands.propose({
    principal: saved.principal,
    intent: {
      domainId: 'personal',
      operation: 'complete',
      ref: item.ref,
      payload: {},
      sourceReceipt: receipt,
      statement: 'I finished Contact Sample',
      title: item.title,
      mode: 'auto',
      expectedVersion: item.version
    },
    asOf: x.now()
  })).rejects.toThrow();
  expect(x.writes).toHaveLength(0);
});
it('a pronoun correction during debounce blocks the earlier automatic action', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(1000);
  const correction = await x.save("Actually, I didn't finish it.", {
    messageId: '100'
  });
  await x.runtime.conversation.onEntrySaved({
    ...correction,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it('refuses to upgrade a stale automatic observation to a new recurring occurrence', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  x.changeNative({
    completed_count: 1,
    due: {
      date: '2026-11-19',
      is_recurring: true,
      string: 'every day'
    }
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it('a selected stale task cannot silently adopt a new live version', async () => {
  const x = await setup(),
    p = x.capture('99', 'text');
  const page = await x.runtime.conversation.open({
    principal: p,
    flow: 'tasks',
    asOf: x.now()
  });
  await x.runtime.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '400',
    asOf: x.now()
  });
  x.changeNative({
    completed_count: 1,
    due: {
      date: '2026-11-19',
      is_recurring: true,
      string: 'every day'
    }
  });
  const token = page.choices[0][0].callback_data;
  const result = await x.runtime.conversation.handleCallback({
    principal: x.capture('400', 'callback', token),
    callbackData: token,
    botMessageId: '400',
    asOf: x.now()
  });
  expect(result.status).toBe('denied');
  expect(x.writes).toHaveLength(0);
});
it.each(['create_task', 'create_container'])('the %s keyboard requests a title instead of completing a destination', async flow => {
  const x = await setup();
  const page = await x.runtime.conversation.open({
    principal: x.capture('99', 'text'),
    flow,
    asOf: x.now()
  });
  expect(page.text.toLowerCase()).toContain('title');
  expect(page.text).not.toContain('Complete task');
  expect(page.choices ?? []).toHaveLength(0);
  expect(x.writes).toHaveLength(0);
});
it('renames a projected native-name container through a live version-bound choice', async () => {
  const x = await setup();
  x.config.work.providers.p.operations.push('rename_container');
  x.models.mockResolvedValue({
    intents: [{
      operation: 'rename_container',
      domainId: 'personal',
      title: 'Personal errands',
      newTitle: 'Housework',
      quote: 'Rename project Personal errands to Housework'
    }]
  });
  const saved = await x.save('Rename project Personal errands to Housework');
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  const selection = x.sent.at(-1);
  expect(selection?.text).toContain('Personal errands');
  const token = selection.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(selection.messageId, 'callback', token),
    callbackData: token,
    botMessageId: selection.messageId
  });
  expect(x.sent.at(-1).text).toContain('Housework');
  expect(x.sent.at(-1).text).toContain('Rename project');
  expect(x.writes).toHaveLength(0);
});
it('can confirm the offered reopen after the completed task disappears from the open harvest', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  await x.harvest();
  const edited = await x.save("I did not finish Contact Sample", {
    edited: true
  });
  await x.runtime.conversation.onEntrySaved({
    ...edited,
    asOf: x.now()
  });
  const first = x.sent.at(-1),
    token = first.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(first.messageId, 'callback', token),
    callbackData: token,
    botMessageId: first.messageId
  });
  const confirm = x.sent.at(-1);
  expect(confirm.text).toContain('Reopen task');
  const yes = confirm.choices[0][0].callback_data;
  const r = await x.adapter().handleCallback({
    principal: x.capture(confirm.messageId, 'callback', yes),
    callbackData: yes,
    botMessageId: confirm.messageId
  });
  expect(r.status).toBe('applied');
  expect(x.writes).toHaveLength(2);
  expect(x.writes[1].url).toContain('/reopen');
});
it('reconciles a known-target uncertain completion on the next successful harvest without another write', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  x.failWrites();
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(Object.values(x.readState().state.commands)[0].status).toBe('uncertain');
  await x.harvest();
  expect(Object.values(x.readState().state.commands)[0].status).toBe('applied');
  expect(x.writes).toHaveLength(1);
});
it('does not allow delayed KB closure after a newer native snapshot shows the task reopened', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  await x.harvest();
  const state = x.readState().state,
    event = Object.values(state.activities)[0].event,
    links = Object.values(state.links);
  await x.advance(1000);
  x.changeNative({
    checked: false,
    completed_at: null,
    completed_count: 0,
    updated_at: new Date(x.now()).toISOString()
  });
  await x.harvest();
  expect((await x.runtime.activities.verifyProviderEvent({
    username: 'sample',
    event,
    links,
    asOf: x.now()
  })).closureAllowed).toBe(false);
});
it('prevents HTTP initiation if disposal starts during final credential lookup', async () => {
  const x = await setup(),
    saved = await x.save();
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  const selection = x.sent.at(-1),
    choose = selection.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(selection.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: selection.messageId
  });
  const page = x.sent.at(-1),
    token = page.choices[0][0].callback_data;
  let entered,
    release,
    n = 0;
  const started = new Promise(r => entered = r),
    gate = new Promise(r => release = r);
  x.setAuthHook(async () => {
    if (++n === 2) {
      entered();
      await gate;
    }
  });
  const action = x.adapter().handleCallback({
    principal: x.capture(page.messageId, 'callback', token),
    callbackData: token,
    botMessageId: page.messageId
  });
  await started;
  const stopped = x.runtime.dispose();
  release();
  await Promise.all([action, stopped]);
  expect(x.writes).toHaveLength(0);
});
it.each([['101'], ['101', '102']])('creates in an assignee-filtered destination with a visible selected assignment %s', async (...ids) => {
  const x = await setup();
  x.config.work.domains.personal.assigneeIds = ids;
  x.models.mockResolvedValue({
    intents: [{
      operation: 'create_task',
      domainId: 'personal',
      title: 'Pay bill',
      quote: 'Create task Pay bill'
    }]
  });
  const saved = await x.save('Create task Pay bill');
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  const selection = x.sent.at(-1),
    choose = selection.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(selection.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: selection.messageId
  });
  const page = x.sent.at(-1);
  expect(page.text).toContain('101');
  const token = page.choices[0][0].callback_data;
  const result = await x.adapter().handleCallback({
    principal: x.capture(page.messageId, 'callback', token),
    callbackData: token,
    botMessageId: page.messageId
  });
  expect(result.status).toBe('applied');
  expect(x.writes[0].body.assignee_id).toBe('101');
});
it('a directly replied retraction without a repeated title suspends pending completion', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(1000);
  const reply = await x.save('Wait—no.', {
    messageId: '100',
    replyToMessageId: '99'
  });
  await x.runtime.conversation.onEntrySaved({
    ...reply,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it('an interactive flow receipt cannot authorize automatic completion', async () => {
  const x = await setup(),
    saved = await x.save();
  const {
    item
  } = await linkSaved(x, saved);
  await x.runtime.conversation.open({
    principal: saved.principal,
    flow: 'tasks',
    asOf: x.now()
  });
  const sourceReceipt = 'source.' + workHash(['sample', saved.principal.receiptId, 'interactive']);
  await expect(x.runtime.commands.propose({
    principal: saved.principal,
    intent: {
      domainId: 'personal',
      operation: 'complete',
      ref: item.ref,
      payload: {},
      sourceReceipt,
      statement: 'I finished Contact Sample',
      title: item.title,
      mode: 'auto',
      expectedVersion: item.version
    },
    asOf: x.now()
  })).rejects.toThrow();
  expect(x.writes).toHaveLength(0);
});
it('keeps the journal-time occurrence binding even if a newer harvest arrives before interpretation', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  x.changeNative({
    completed_count: 1,
    due: {
      date: '2026-11-19',
      is_recurring: true,
      string: 'every day'
    }
  });
  await x.harvest();
  await x.advance(15 * 60000);
  expect(x.writes).toHaveLength(0);
});
it('discovers a named reopen from scoped completed history after open-task removal', async () => {
  const x = await setup(),
    saved = await x.save();
  await linkSaved(x, saved);
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  await x.advance(15 * 60000);
  await x.harvest();
  x.models.mockResolvedValue({
    intents: [{
      operation: 'reopen',
      domainId: 'personal',
      title: 'Contact Sample',
      quote: 'Reopen task Contact Sample'
    }]
  });
  const request = await x.save('Reopen task Contact Sample', {
    messageId: '101'
  });
  const result = await x.runtime.conversation.onEntrySaved({
    ...request,
    asOf: x.now()
  });
  expect(result.suppressFollowUp).toBe(true);
  expect(x.sent.at(-1).text).toContain('Contact Sample');
  const selection = x.sent.at(-1),
    choose = selection.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(selection.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: selection.messageId
  });
  const page = x.sent.at(-1);
  expect(page.text).toContain('Reopen task');
  const token = page.choices[0][0].callback_data;
  expect((await x.adapter().handleCallback({
    principal: x.capture(page.messageId, 'callback', token),
    callbackData: token,
    botMessageId: page.messageId
  })).status).toBe('applied');
  expect(x.writes).toHaveLength(2);
});
it('an uncertain create identifies its destination for manual inspection and never offers blind retry', async () => {
  const x = await setup();
  x.models.mockResolvedValue({
    intents: [{
      operation: 'create_task',
      domainId: 'personal',
      title: 'Pay bill',
      quote: 'Create task Pay bill'
    }]
  });
  const saved = await x.save('Create task Pay bill');
  await x.runtime.conversation.onEntrySaved({
    ...saved,
    asOf: x.now()
  });
  const selection = x.sent.at(-1),
    choose = selection.choices[0][0].callback_data;
  await x.adapter().handleCallback({
    principal: x.capture(selection.messageId, 'callback', choose),
    callbackData: choose,
    botMessageId: selection.messageId
  });
  const page = x.sent.at(-1),
    token = page.choices[0][0].callback_data;
  x.failWrites();
  const result = await x.adapter().handleCallback({
    principal: x.capture(page.messageId, 'callback', token),
    callbackData: token,
    botMessageId: page.messageId
  });
  expect(result.status).toBe('uncertain');
  expect(x.sent.at(-1).text).toContain('Personal errands');
  expect(x.sent.at(-1).text).toContain('Inspect');
  await x.harvest();
  expect(x.writes).toHaveLength(1);
});
