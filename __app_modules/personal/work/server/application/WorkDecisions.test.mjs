import { it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkDecisions } from './WorkDecisions.mjs';
import { WorkCommands } from './WorkCommands.mjs';
import { createWorkCallbackTokens } from '../adapters/WorkCallbackTokens.mjs';
import { harness, item, ref } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';
const resources = [];
afterEach(async () => {
  for (const h of resources.splice(0)) await h.close();
});
async function setup() {
  const h = harness();
  resources.push(h);
  const state = h.make(),
    trusted = new WeakSet(),
    writes = [];
  let version = 'item-v1';
  const actor = patch => {
    const p = Object.freeze({
      username: 'sample',
      senderId: '101',
      conversationId: 'telegram:private',
      messageId: '1',
      kind: 'text',
      authored: true,
      receiptId: randomUUID(),
      receivedAt: AS_OF,
      edited: false,
      ...patch
    });
    trusted.add(p);
    return p;
  };
  const principal = actor({
    receiptId: 'source-1'
  });
  const verifyPrincipal = p => trusted.has(p) ? p : null;
  const policy = {
    username: 'sample',
    enabled: true,
    providerWrites: true,
    revision: 'policy-1',
    writer: {
      write: true
    },
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
    }
  };
  let decisions;
  const context = {
    execute: async () => ({
      coverage: {
        complete: true
      },
      items: [item()],
      containers: [],
      links: []
    }),
    verifySource: async () => true,
    verifyConfirmation: input => decisions.verifyConfirmation(input)
  };
  const provider = {
    capabilities: () => ({
      complete: true
    }),
    getItem: async () => item({
      version
    }),
    execute: async ({
      command
    }) => {
      if (command.expectedVersion !== version) return {
        outcome: 'conflict',
        ref,
        item: null,
        observation: null,
        reason: 'version_changed',
        retryAfter: null
      };
      writes.push(command);
      version = 'done-v2';
      return {
        outcome: 'applied',
        ref,
        item: item({
          version,
          status: {
            native: 'done',
            category: 'done'
          }
        }),
        observation: null,
        reason: null,
        retryAfter: null
      };
    }
  };
  const commands = new WorkCommands({
    state,
    providers: new Map([['["todoist","personal"]', provider]]),
    context,
    resolvePolicy: () => policy,
    verifyPrincipal,
    clock: () => AS_OF
  });
  const tokens = createWorkCallbackTokens();
  const options = {
    state,
    commands,
    context,
    resolvePolicy: () => policy,
    verifyPrincipal,
    clock: () => AS_OF,
    nextId: randomUUID,
    tokens
  };
  decisions = new WorkDecisions(options);
  const proposed = await commands.propose({
    principal,
    intent: {
      operation: 'complete',
      domainId: 'personal',
      ref,
      payload: {},
      statement: 'Mark Contact Sample done',
      title: 'Contact Sample',
      sourceReceipt: 'source-1',
      mode: 'manual'
    },
    asOf: AS_OF
  });
  const prepare = () => decisions.prepare({
    principal,
    commandId: proposed.command.id,
    asOf: AS_OF
  });
  const callback = (token, patch = {}) => actor({
    kind: 'callback',
    messageId: '200',
    callbackData: token,
    ...patch
  });
  return {
    h,
    state,
    decisions,
    options,
    prepare,
    callback,
    policy,
    writes,
    principal,
    provider,
    commands,
    commandId: proposed.command.id,
    setVersion: value => {
      version = value;
    }
  };
}
it('persists only hashed opaque tokens, requires ACK and executes a bound choice once', async () => {
  const x = await setup(),
    page = await x.prepare(),
    token = page.choices[0][0].callback_data;
  expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
  expect(page.choices[0][0].text).toBe('Complete task');
  expect(page.text).toContain('Contact Sample');
  expect(fs.readFileSync(path.join(x.h.rootForUser('sample'), 'events.jsonl'), 'utf8')).not.toContain(token);
  expect((await x.decisions.reply({
    principal: x.callback(token),
    token,
    botMessageId: '200',
    asOf: AS_OF
  })).status).toBe('denied');
  await x.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '200',
    asOf: AS_OF
  });
  const p = x.callback(token);
  expect((await x.decisions.reply({
    principal: p,
    token,
    botMessageId: '200',
    asOf: AS_OF
  })).status).toBe('applied');
  await x.decisions.reply({
    principal: p,
    token,
    botMessageId: '200',
    asOf: AS_OF
  });
  expect(x.writes).toHaveLength(1);
});
it.each(['user', 'message', 'expired', 'policy', 'version', 'serialized', 'uncertain'])('refuses %s without a write', async why => {
  const x = await setup(),
    page = await x.prepare(),
    token = page.choices[0][0].callback_data;
  await x.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '200',
    asOf: AS_OF
  });
  let p = x.callback(token),
    asOf = AS_OF;
  if (why === 'user') p = x.callback(token, {
    username: 'other',
    senderId: '202',
    conversationId: 'other'
  });
  if (why === 'message') p = x.callback(token, {
    messageId: '201'
  });
  if (why === 'expired') asOf += 86400001;
  if (why === 'policy') x.policy.revision = 'new';
  if (why === 'version') x.setVersion('new-version');
  if (why === 'serialized') p = {
    ...p
  };
  if (why === 'uncertain') await x.decisions.recordFailure({
    username: 'sample',
    decisionId: page.decisionId,
    uncertain: true,
    asOf: AS_OF
  });
  expect(['denied', 'conflict']).toContain((await x.decisions.reply({
    principal: p,
    token,
    botMessageId: '200',
    asOf
  })).status);
  expect(x.writes).toEqual([]);
});
it('survives restart with a delivered token but never grants authority to an unbound label', async () => {
  const x = await setup(),
    page = await x.prepare(),
    token = page.choices[0][0].callback_data;
  await x.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '200',
    asOf: AS_OF
  });
  expect((await x.decisions.reply({
    principal: x.callback('Complete task'),
    token: 'Complete task',
    botMessageId: '200',
    asOf: AS_OF
  })).status).toBe('denied');
  const restarted = new WorkDecisions(x.options);
  x.options.context.verifyConfirmation = input => restarted.verifyConfirmation(input);
  expect((await restarted.reply({
    principal: x.callback(token),
    token,
    botMessageId: '200',
    asOf: AS_OF
  })).status).toBe('applied');
  expect(x.writes).toHaveLength(1);
});
it('serializes duplicate concurrent confirmation callbacks', async () => {
  const x = await setup(),
    page = await x.prepare(),
    token = page.choices[0][0].callback_data;
  await x.decisions.recordDelivery({
    username: 'sample',
    decisionId: page.decisionId,
    botMessageId: '200',
    asOf: AS_OF
  });
  await Promise.all([x.decisions.reply({
    principal: x.callback(token),
    token,
    botMessageId: '200',
    asOf: AS_OF
  }), x.decisions.reply({
    principal: x.callback(token),
    token,
    botMessageId: '200',
    asOf: AS_OF
  })]);
  expect(x.writes).toHaveLength(1);
});
it('names the new task and actual destination in creation confirmation', async () => {
  const x = await setup();
  x.policy.providers.p.operations.push('create_task');
  x.provider.capabilities = () => ({
    complete: true,
    create_task: true
  });
  const destination = {
    ref: {
      ...ref,
      kind: 'container',
      id: 'sample-project'
    },
    title: 'Household errands',
    version: 'container-v1'
  };
  x.options.context.execute = async () => ({
    coverage: {
      complete: true
    },
    items: [],
    containers: [destination],
    links: []
  });
  x.provider.getItem = async () => destination;
  const proposed = await x.commands.propose({
    principal: x.principal,
    intent: {
      operation: 'create_task',
      domainId: 'personal',
      ref: null,
      payload: {
        title: 'Pay bill',
        containerId: 'sample-project'
      },
      title: destination.title,
      sourceReceipt: 'source-1',
      mode: 'manual'
    },
    asOf: AS_OF
  });
  const page = await x.decisions.prepare({
    principal: x.principal,
    commandId: proposed.command.id,
    asOf: AS_OF
  });
  expect(page.text).toContain('Pay bill');
  expect(page.text).toContain('Household errands');
});
it('shows the requested new name in a project rename confirmation', async () => {
  const x = await setup();
  x.policy.providers.p.operations.push('rename_container');
  x.provider.capabilities = () => ({
    complete: true,
    rename_container: true
  });
  const destination = {
    ref: {
      ...ref,
      kind: 'container',
      id: 'sample-project'
    },
    title: 'Old group',
    version: 'container-v1'
  };
  x.options.context.execute = async () => ({
    coverage: {
      complete: true
    },
    items: [],
    containers: [destination],
    links: []
  });
  x.provider.getItem = async () => destination;
  const proposed = await x.commands.propose({
    principal: x.principal,
    intent: {
      operation: 'rename_container',
      domainId: 'personal',
      ref: destination.ref,
      payload: {
        title: 'New group'
      },
      title: destination.title,
      sourceReceipt: 'source-1',
      mode: 'manual'
    },
    asOf: AS_OF
  });
  const page = await x.decisions.prepare({
    principal: x.principal,
    commandId: proposed.command.id,
    asOf: AS_OF
  });
  expect(page.text).toContain('Old group');
  expect(page.text).toContain('New group');
});
it('creates a reviewable project command under an explicit parent outside normal task scope', async () => {
  const x = await setup();
  x.policy.providers.p.operations.push('create_container');
  x.policy.domains.personal.creationParentId = 'parent-project';
  x.provider.capabilities = () => ({
    complete: true,
    create_container: true
  });
  const parent = {
    ref: {
      ...ref,
      kind: 'container',
      id: 'parent-project'
    },
    title: 'Family plans',
    version: 'parent-v1'
  };
  x.provider.getItem = async () => parent;
  const proposed = await x.commands.propose({
    principal: x.principal,
    intent: {
      operation: 'create_container',
      domainId: 'personal',
      ref: null,
      payload: {
        title: 'Holiday',
        parentId: 'parent-project'
      },
      title: parent.title,
      sourceReceipt: 'source-1',
      mode: 'manual'
    },
    asOf: AS_OF
  });
  const page = await x.decisions.prepare({
    principal: x.principal,
    commandId: proposed.command.id,
    asOf: AS_OF
  });
  expect(page.text).toContain('Holiday');
  expect(page.text).toContain('Family plans');
});
it('names the actual configured transition instead of labeling acceptance as review', async () => {
  const x = await setup();
  x.policy.providers.p = {
    type: 'clickup',
    accountId: 'delivery',
    operations: ['read', 'transition']
  };
  x.policy.domains.personal.transitions = {
    code_checked_in: 'accepted'
  };
  const command = {
    id: 'command.' + 'f'.repeat(64),
    username: 'sample',
    domainId: 'personal',
    ref: {
      provider: 'clickup',
      accountId: 'delivery',
      kind: 'task',
      id: 'module-x'
    },
    operation: 'transition',
    payload: {
      transition: 'code_checked_in'
    },
    expectedVersion: 'v1',
    sourceReceipt: 'source-1',
    confirmationId: null,
    createdAt: AS_OF
  };
  const current = await x.state.read({
    username: 'sample'
  });
  await x.state.transact({
    username: 'sample',
    id: 'transition-ui',
    expectedRevision: current.revision,
    events: [{
      type: 'command.queued',
      record: {
        command,
        status: 'queued',
        requiresConfirmation: true,
        policyRevision: 'policy-1',
        intent: {
          title: 'Module X'
        },
        result: null
      }
    }],
    asOf: AS_OF
  });
  const page = await x.decisions.prepare({
    principal: x.principal,
    commandId: command.id,
    asOf: AS_OF
  });
  expect(page.choices[0][0].text).toBe('Move to accepted');
  expect(page.text).toContain('accepted');
});
