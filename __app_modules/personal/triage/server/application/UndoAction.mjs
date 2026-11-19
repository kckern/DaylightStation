// Undo replays an action-log entry's inverse. Outcomes:
// 'undone' | 'already_undone' | 'conflict' | 'not_undoable' | 'failed' (with reason).
import { MAILBOX_SCOPE_MISSING } from '../ports/IMailbox.mjs';

export function createUndoAction({ store, mailbox, work, clock = () => Date.now(), logger = null }) {
  const chains = new Map();
  const log = (event, data) => logger?.[event.endsWith('failed') || event.endsWith('conflict') ? 'warn' : 'info']?.(event, data);

  const serialize = (username, fn) => {
    const prev = chains.get(username) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => {});
    chains.set(username, tail);
    tail.then(() => { if (chains.get(username) === tail) chains.delete(username); });
    return run;
  };

  const viaWork = async ({ username, entry, principal, operation, payload }) => {
    const { inverse } = entry;
    const asOf = clock();
    const intent = {
      operation,
      domainId: inverse.payload?.domainId,
      ref: inverse.ref,
      payload,
      sourceReceipt: `triage-undo:${entry.id}`,
    };
    const proposed = await work.commands.propose({ principal, intent, asOf });
    if (proposed?.outcome === 'denied') return { outcome: 'failed', reason: proposed.reason ?? 'denied' };
    if (!proposed?.command) return { outcome: 'failed', reason: 'propose_failed' };
    const { confirmationId } = await work.decisions.confirmWeb({
      principal, commandId: proposed.command.id, expectedVersion: proposed.command.expectedVersion, asOf,
    });
    const r = await work.commands.execute({ principal, commandId: proposed.command.id, confirmationId, asOf });
    if (r.outcome === 'applied' || r.outcome === 'already_applied') return { outcome: 'undone' };
    if (r.outcome === 'conflict') return { outcome: 'conflict' };
    return { outcome: 'failed', reason: r.reason ?? r.outcome };
  };

  const replay = async ({ username, entry, principal }) => {
    const inv = entry.inverse;
    if (inv.action === 'unarchive' || inv.action === 'archive') {
      const id = inv.ref?.id;
      if (inv.action === 'unarchive') await mailbox.unarchive(username, id);
      else await mailbox.archive(username, id);
      return { outcome: 'undone' };
    }
    if (inv.action === 'reopen') return viaWork({ username, entry, principal, operation: 'reopen', payload: {} });
    if (inv.action === 'update_task') {
      const { dueDate } = inv.payload ?? {};
      return viaWork({ username, entry, principal, operation: 'update_task', payload: { dueDate } });
    }
    return { outcome: 'not_undoable' };
  };

  const undoOne = async ({ username, entryId, principal }) => {
    const entry = await store.getEntry(username, entryId);
    if (!entry) { log('triage.undo.not_undoable', { username, entryId, reason: 'unknown_entry' }); return { outcome: 'not_undoable' }; }
    if (entry.undoneAt) return { outcome: 'already_undone' };
    if (entry.dryRun === true || !entry.inverse) {
      log('triage.undo.not_undoable', { username, entryId, dryRun: entry.dryRun === true });
      return { outcome: 'not_undoable' };
    }
    let result;
    try {
      result = await replay({ username, entry, principal });
    } catch (err) {
      result = err?.code === MAILBOX_SCOPE_MISSING
        ? { outcome: 'failed', reason: 'mailbox_permission_missing' }
        : { outcome: 'failed', reason: err?.message ?? 'error' };
    }
    if (result.outcome === 'undone') {
      await store.markUndone(username, entryId, clock());
      log('triage.undo.applied', { username, entryId, action: entry.inverse.action });
    } else if (result.outcome === 'conflict') {
      log('triage.undo.conflict', { username, entryId });
    } else if (result.outcome === 'failed') {
      log('triage.undo.failed', { username, entryId, reason: result.reason });
    } else {
      log('triage.undo.not_undoable', { username, entryId });
    }
    return result;
  };

  return { undo: (args) => serialize(args.username, () => undoOne(args)) };
}
export default createUndoAction;
