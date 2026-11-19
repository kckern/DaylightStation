// Undo replays an action-log entry's inverse. Outcomes:
// 'undone' (optionally with warning 'log_not_marked') | 'already_undone' | 'conflict'
// | 'not_undoable' | 'failed' (with reason).
//
// Task entries (reopen / update_task) need a WEB principal: the owner's own login
// session proposes and confirms the inverse. A system principal is refused by the
// work layer for these operations. The intent carries no sourceReceipt: the work
// layer binds a web proposal to the principal's own receipt.
// A task entry's `inverse` must carry { ref, expectedVersion, payload: { domainId, dueDate? } }
// where expectedVersion is the item version AFTER the logged action. Provider
// specifics (e.g. a reopen status) are filled in by the work layer, never here.
import { MAILBOX_SCOPE_MISSING } from '../ports/IMailbox.mjs';

const CONFLICT_CODES = new Set(['WORK_SELECTION_CHANGED']);

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

  const viaWork = async ({ entry, principal, operation, payload }) => {
    const { inverse } = entry;
    const asOf = clock();
    const intent = {
      operation,
      domainId: inverse.payload?.domainId,
      ref: inverse.ref,
      payload,
      expectedVersion: inverse.expectedVersion,
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
    if (inv.action === 'reopen') return viaWork({ entry, principal, operation: 'reopen', payload: {} });
    if (inv.action === 'update_task') {
      // No prior due date -> an explicit clear, never an undefined field.
      const dueDate = inv.payload?.dueDate ?? null;
      return viaWork({ entry, principal, operation: 'update_task', payload: { dueDate } });
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
      result = err?.code === MAILBOX_SCOPE_MISSING ? { outcome: 'failed', reason: 'mailbox_permission_missing' }
        : CONFLICT_CODES.has(err?.code) ? { outcome: 'conflict' }
        : { outcome: 'failed', reason: err?.code ?? err?.message ?? 'error' };
    }
    if (result.outcome === 'undone') {
      // The inverse already ran; a log failure must not make the next undo repeat it.
      try {
        const marked = await store.markUndone(username, entryId, clock());
        if (!marked) {
          result = { outcome: 'undone', warning: 'log_not_marked' };
          logger?.error?.('triage.undo.log_not_marked', { username, entryId, reason: 'entry_missing' });
        }
      } catch (err) {
        result = { outcome: 'undone', warning: 'log_not_marked' };
        logger?.error?.('triage.undo.log_not_marked', { username, entryId, error: err?.message });
      }
      log('triage.undo.applied', { username, entryId, action: entry.inverse.action, warning: result.warning });
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
