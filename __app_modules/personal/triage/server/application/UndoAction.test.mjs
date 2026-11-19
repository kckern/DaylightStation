import { describe, it, expect, vi } from 'vitest';
import { createUndoAction } from './UndoAction.mjs';
import { createYamlTriageStore } from '../adapters/YamlTriageStore.mjs';

const NOW = Date.parse('2026-11-19T12:00:00Z');
function setup(entries) {
  const files = new Map();
  const dataService = { user: {
    readStrict: vi.fn((p, u) => {
      const v = files.get(`${u}/${p}`);
      if (v instanceof Error) throw v;
      return v ?? null;
    }),
    writeAtomic: vi.fn((p, d, u) => { files.set(`${u}/${p}`, structuredClone(d)); return true; }),
  } };
  const store = createYamlTriageStore({ dataService, clock: () => NOW, logger: { error: vi.fn() } });
  const mailbox = { archive: vi.fn(async () => ({})), unarchive: vi.fn(async () => ({ version: '2' })) };
  const work = {
    commands: {
      propose: vi.fn(async () => ({ command: { id: 'c1', expectedVersion: 'v1' }, requiresConfirmation: true })),
      execute: vi.fn(async () => ({ outcome: 'applied' })),
    },
    decisions: { confirmWeb: vi.fn(async () => ({ confirmationId: 'conf1' })) },
  };
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const undo = createUndoAction({ store, mailbox, work, clock: () => NOW, logger });
  const ready = Promise.all(entries.map((e) => store.appendLog('kc', e)));
  return { store, mailbox, work, logger, undo, ready, files, dataService };
}
const entry = (o) => ({ id: 'e1', at: NOW - 1000, actor: 'system', itemId: 'i', kind: 'email', ref: { id: 'm1' }, action: 'archive', inverse: { action: 'unarchive', ref: { id: 'm1' } }, dryRun: false, undoneAt: null, ...o });
const principal = { username: 'kc' };

describe('UndoAction', () => {
  it('unarchives and sets undoneAt; second undo is already_undone', async () => {
    const s = setup([entry()]); await s.ready;
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('undone');
    expect(s.mailbox.unarchive).toHaveBeenCalledWith('kc', 'm1');
    expect((await s.store.getEntry('kc', 'e1')).undoneAt).toBe(NOW);
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('already_undone');
    expect(s.mailbox.unarchive).toHaveBeenCalledTimes(1);
  });
  it('simultaneous undos act once', async () => {
    const s = setup([entry()]); await s.ready;
    const r = await Promise.all([1, 2].map(() => s.undo.undo({ username: 'kc', entryId: 'e1', principal })));
    expect(r.map((x) => x.outcome).sort()).toEqual(['already_undone', 'undone']);
    expect(s.mailbox.unarchive).toHaveBeenCalledTimes(1);
  });
  it('complete -> reopen through propose, confirmWeb, execute', async () => {
    const s = setup([entry({ kind: 'todo', action: 'complete', inverse: { action: 'reopen', ref: { provider: 'p', accountId: 'a', kind: 'task', id: 't' }, payload: { domainId: 'd' } } })]); await s.ready;
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('undone');
    expect(s.work.commands.propose.mock.calls[0][0].intent).toMatchObject({ operation: 'reopen', domainId: 'd' });
    expect(s.work.decisions.confirmWeb).toHaveBeenCalled();
    expect(s.work.commands.execute.mock.calls[0][0]).toMatchObject({ commandId: 'c1', confirmationId: 'conf1' });
  });
  it('update_task restores the prior dueDate', async () => {
    const s = setup([entry({ action: 'update_task', inverse: { action: 'update_task', ref: { id: 't' }, payload: { domainId: 'd', dueDate: '2026-11-01' } } })]); await s.ready;
    await s.undo.undo({ username: 'kc', entryId: 'e1', principal });
    expect(s.work.commands.propose.mock.calls[0][0].intent).toMatchObject({ operation: 'update_task', payload: { dueDate: '2026-11-01' } });
  });
  it('clears the due date explicitly when there was none, and passes expectedVersion', async () => {
    const s = setup([entry({ action: 'update_task', inverse: { action: 'update_task', ref: { id: 't' }, expectedVersion: 'v9', payload: { domainId: 'd' } } })]); await s.ready;
    await s.undo.undo({ username: 'kc', entryId: 'e1', principal });
    const intent = s.work.commands.propose.mock.calls[0][0].intent;
    expect(intent.payload).toEqual({ dueDate: null });
    expect(intent.expectedVersion).toBe('v9');
    expect(intent).not.toHaveProperty('sourceReceipt');
  });
  it('maps a thrown WORK_SELECTION_CHANGED to conflict', async () => {
    const s = setup([entry({ inverse: { action: 'reopen', ref: { id: 't' }, payload: { domainId: 'd' } } })]); await s.ready;
    s.work.commands.propose.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'WORK_SELECTION_CHANGED' }));
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('conflict');
  });
  it('still reports undone (with a warning) when the log cannot be marked', async () => {
    const s = setup([entry()]); await s.ready;
    s.dataService.user.writeAtomic.mockImplementationOnce(() => false);
    expect(await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).toEqual({ outcome: 'undone', warning: 'log_not_marked' });
    expect(s.logger.error).toHaveBeenCalledWith('triage.undo.log_not_marked', expect.any(Object));
  });
  it('dryRun and sent entries are not_undoable, nothing called', async () => {
    const s = setup([entry({ dryRun: true }), entry({ id: 'e2', action: 'send', inverse: null })]); await s.ready;
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('not_undoable');
    expect((await s.undo.undo({ username: 'kc', entryId: 'e2', principal })).outcome).toBe('not_undoable');
    expect(s.mailbox.unarchive).not.toHaveBeenCalled();
    expect(s.work.commands.propose).not.toHaveBeenCalled();
  });
  it('maps work conflict, failures and missing mailbox scope', async () => {
    const s = setup([entry({ kind: 'todo', inverse: { action: 'reopen', ref: { id: 't' }, payload: { domainId: 'd' } } }), entry({ id: 'e2' })]); await s.ready;
    s.work.commands.execute.mockResolvedValueOnce({ outcome: 'conflict' });
    expect((await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).outcome).toBe('conflict');
    s.work.commands.execute.mockResolvedValueOnce({ outcome: 'uncertain', reason: 'timeout' });
    expect(await s.undo.undo({ username: 'kc', entryId: 'e1', principal })).toEqual({ outcome: 'failed', reason: 'timeout' });
    expect((await s.store.getEntry('kc', 'e1')).undoneAt).toBeNull();
    s.mailbox.unarchive.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'MAILBOX_SCOPE_MISSING' }));
    expect(await s.undo.undo({ username: 'kc', entryId: 'e2', principal })).toEqual({ outcome: 'failed', reason: 'mailbox_permission_missing' });
    expect((await s.store.getEntry('kc', 'e2')).undoneAt).toBeNull();
  });
});
describe('YamlTriageStore', () => {
  it('refuses to overwrite a corrupt log or queue', async () => {
    const s = setup([]);
    s.files.set('kc/apps/triage/log/2026-11', new Error('bad yaml'));
    await expect(s.store.appendLog('kc', entry())).rejects.toThrow(/unreadable/);
    expect(s.dataService.user.writeAtomic).not.toHaveBeenCalled();
    s.files.set('kc/apps/triage/queue', 'garbage');
    await expect(s.store.readQueue('kc')).rejects.toThrow(/unreadable/);
    s.files.set('kc/apps/triage/log/2026-11', { not: 'a list' });
    await expect(s.store.readLog('kc', { sinceMs: 0 })).rejects.toThrow(/unreadable/);
  });
  it('round-trips queue and filters the log by sinceMs', async () => {
    const s = setup([entry({ id: 'old', at: NOW - 40 * 86400000 }), entry({ id: 'new' })]); await s.ready;
    await s.store.writeQueue('kc', { passId: 'p', builtAt: 1, cards: [] });
    expect((await s.store.readQueue('kc')).passId).toBe('p');
    expect((await s.store.readLog('kc', { sinceMs: NOW - 86400000 })).map((e) => e.id)).toEqual(['new']);
  });
});
