// Runs UndoAction against the REAL WorkCommands + WorkDecisions (state harness) and the
// real Todoist request validator, so a mock cannot hide an intent the work layer refuses.
import { it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createUndoAction } from './UndoAction.mjs';
import { WorkCommands } from '../../../work/server/application/WorkCommands.mjs';
import { WorkDecisions } from '../../../work/server/application/WorkDecisions.mjs';
import { createWorkCallbackTokens } from '../../../work/server/adapters/WorkCallbackTokens.mjs';
import { todoistRequest } from '../../../work/server/adapters/TodoistWorkClient.mjs';
import { harness, item, ref } from '../../../../../tests/_lib/work/stateHarness.mjs';
import { AS_OF } from '../../../../../tests/_lib/work/observations.mjs';

const resources = [];
afterEach(async () => { for (const h of resources.splice(0)) await h.close(); });

async function setup() {
  const h = harness(); resources.push(h);
  const trusted = new WeakSet();
  const actor = (patch) => { const p = Object.freeze({ username: 'sample', kind: 'session', authored: true, receivedAt: AS_OF, edited: false, ...patch }); trusted.add(p); return p; };
  const verifyPrincipal = (p) => (trusted.has(p) ? p : null);
  const policy = {
    username: 'sample', enabled: true, providerWrites: true, revision: 'policy-1', writer: { write: true },
    providers: { p: { type: 'todoist', accountId: 'personal', operations: ['read', 'reopen', 'update_task'] } },
    domains: { personal: { provider: 'p', containerId: 'sample-project', role: 'tasks' } },
  };
  const sent = [];
  const provider = {
    capabilities: () => ({ read: true, reopen: true, update_task: true }),
    getItem: async () => item({ status: { native: 'done', category: 'done' }, due: { date: '2026-11-18', at: null, recurring: false, occurrenceId: null } }),
    execute: vi.fn(async ({ command }) => {
      sent.push(todoistRequest({ operation: command.operation, ref: command.ref, payload: command.payload })); // real validator
      return { outcome: 'applied', ref, item: item(), observation: null, reason: null, retryAfter: null };
    }),
  };
  const context = { execute: async () => ({ coverage: { complete: true }, items: [item()], containers: [], links: [] }), verifySource: async () => true };
  let decisions;
  context.verifyConfirmation = (i) => decisions.verifyConfirmation(i);
  const state = h.make();
  const commands = new WorkCommands({ state, providers: new Map([['["todoist","personal"]', provider]]), context, resolvePolicy: () => policy, verifyPrincipal, clock: () => AS_OF });
  decisions = new WorkDecisions({ state, commands, context, resolvePolicy: () => policy, verifyPrincipal, clock: () => AS_OF, nextId: randomUUID, tokens: createWorkCallbackTokens(), describeProvider: () => ({ containerNoun: 'project', assigneeField: 'single' }) });
  const entries = new Map();
  const store = {
    getEntry: async (u, id) => entries.get(id) ?? null,
    markUndone: async (u, id, at) => { entries.set(id, { ...entries.get(id), undoneAt: at }); return entries.get(id); },
  };
  const undo = createUndoAction({ store, mailbox: {}, work: { commands, decisions }, clock: () => AS_OF, logger: null });
  const web = actor({ platform: 'web', sessionId: 'sid', receiptId: 'web:req-1' });
  const system = actor({ platform: 'system', kind: 'system', authored: false, receiptId: 'sys-1' });
  const add = (inverse) => entries.set('e1', { id: 'e1', inverse, dryRun: false, undoneAt: null });
  return { undo, add, web, system, sent, provider };
}

it('reopen passes the real propose/confirm/execute path and the provider validator', async () => {
  const s = await setup();
  s.add({ action: 'reopen', ref, expectedVersion: 'item-v1', payload: { domainId: 'personal' } });
  expect((await s.undo.undo({ username: 'sample', entryId: 'e1', principal: s.web })).outcome).toBe('undone');
  expect(s.sent[0].path).toMatch(/\/reopen$/);
});
it('update_task restores a prior due date, or clears it when there was none', async () => {
  let s = await setup();
  s.add({ action: 'update_task', ref, expectedVersion: 'item-v1', payload: { domainId: 'personal', dueDate: '2026-11-01' } });
  expect((await s.undo.undo({ username: 'sample', entryId: 'e1', principal: s.web })).outcome).toBe('undone');
  expect(s.sent[0].body.due_date).toBe('2026-11-01');
  s = await setup();
  s.add({ action: 'update_task', ref, expectedVersion: 'item-v1', payload: { domainId: 'personal' } });
  expect((await s.undo.undo({ username: 'sample', entryId: 'e1', principal: s.web })).outcome).toBe('undone');
  expect(s.sent[0].body.due_string).toBe('no date');
});
it('a stale expectedVersion is a conflict, and nothing is sent', async () => {
  const s = await setup();
  s.add({ action: 'reopen', ref, expectedVersion: 'old-version', payload: { domainId: 'personal' } });
  expect((await s.undo.undo({ username: 'sample', entryId: 'e1', principal: s.web })).outcome).toBe('conflict');
  expect(s.provider.execute).not.toHaveBeenCalled();
});
it('a system principal cannot undo a task entry', async () => {
  const s = await setup();
  s.add({ action: 'reopen', ref, expectedVersion: 'item-v1', payload: { domainId: 'personal' } });
  const r = await s.undo.undo({ username: 'sample', entryId: 'e1', principal: s.system });
  expect(r.outcome).toBe('failed');
  expect(s.provider.execute).not.toHaveBeenCalled();
});
