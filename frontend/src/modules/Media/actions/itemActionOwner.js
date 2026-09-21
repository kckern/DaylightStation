import * as queueOps from '../session/queueOps.js';
import { createUndoLedger } from '../session/undoLedger.js';
import { expandContainerInput, isContainerInput } from '../session/containerExpansion.js';

/** Shared owner algorithm, used by the local controller and screen owner. */
export function createItemActionOwner({ targetId, capture, revision, apply, fetchImpl, now = Date.now }) {
  const ledger = createUndoLedger({ targetId, capture, revision, restore: (snapshot, record) => {
    if (!record.playbackChanged) {
      const current = capture();
      snapshot.position = current.position;
      snapshot.state = current.state;
    }
    return apply(snapshot, { restore: record.playbackChanged, playbackChanged: record.playbackChanged });
  }, now });
  const operations = new Map();
  let pendingQueueIntent = null;
  let playbackIntent = 0;
  function execute(command) {
    const { kind, item, collectionItems, operationId, tappedAt, clearRest } = command;
    if (operations.has(operationId)) return operations.get(operationId);
    const replacesPlayback = kind === 'playNow' || kind === 'shuffle';
    const intent = replacesPlayback ? ++playbackIntent : null;
    ledger.begin({ operationId, tappedAt });
    const mutate = (inputs) => {
      if (replacesPlayback && intent !== playbackIntent) return { ok: false, code: 'ITEM_ACTION_CANCELLED', operationId };
      if (!replacesPlayback) ledger.rebasePending(operationId);
      if (!ledger.canApply(operationId)) return { ok: false, code: 'ITEM_ACTION_CANCELLED', operationId };
      if (!Array.isArray(inputs) || !inputs.length) return { ok: false, code: 'EMPTY_COLLECTION', operationId };
      // An insertion is always a new queue generation, even when the caller
      // selected a queue row carrying an existing queueItemId.
      inputs = inputs.map(input => { const { queueItemId: _priorId, ...fresh } = input ?? {}; return fresh; });
      const before = capture();
      const collection = Array.isArray(collectionItems) || isContainerInput(item);
      let next;
      if (kind === 'playNow' || kind === 'shuffle') {
        const ordered = [...inputs];
        if (kind === 'shuffle') {
          for (let i = ordered.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
          }
        }
        next = queueOps.playNowMany(before, ordered, { clearRest });
        if (collection || kind === 'shuffle') next.config = { ...next.config, shuffle: kind === 'shuffle' };
      } else if (kind === 'playNext') next = queueOps.addUpNextMany(before, inputs);
      else if (kind === 'playFirst') next = queueOps.playNextMany(before, inputs);
      else if (kind === 'add') next = queueOps.addMany(before, inputs);
      else if (kind === 'remove') next = queueOps.remove(before, command.queueItemId);
      else if (kind === 'clear') next = queueOps.clear(before);
      else return { ok: false, code: 'INVALID_ITEM_ACTION' };
      // The ordinary published queue carries the operation correlation, not
      // a synthetic playback receipt. Native playing proof is still required.
      next.queue.items = next.queue.items.map(entry => before.queue.items.some(old => old.queueItemId === entry.queueItemId)
        ? entry : { ...entry, itemActionId: operationId });
      const playbackChanged = kind === 'playNow' || kind === 'shuffle'
        || (kind === 'remove' && before.queue.items[before.queue.currentIndex]?.queueItemId === command.queueItemId);
      if (playbackChanged) next.position = 0;
      const complete = (applied) => {
        if (applied?.ok === false) return applied;
        const added = next.queue.items.filter(x => !before.queue.items.some(old => old.queueItemId === x.queueItemId));
        const ordinal = added.length ? next.queue.items.findIndex(x => x.queueItemId === added[0].queueItemId) + 1 : null;
        const result = record => ({ ok: true, operationId, appliedRevision: record.appliedRevision, expiresAt: record.expiresAt, ordinal, count: added.length });
        const recorded = ledger.applied(operationId);
        return recorded?.then ? recorded.then(result) : result(recorded);
      };
      ledger.applying(operationId, { playbackChanged });
      const applied = apply(next, { playbackChanged, operationId });
      ledger.issued(operationId);
      return applied?.then ? applied.then(complete) : complete(applied);
    };
    // Fetch eagerly, but apply queue edits in invocation order. Resolve errors
    // into a value immediately so an out-of-order failure cannot become an
    // unhandled rejection while it waits behind another expansion.
    const expansion = !collectionItems && isContainerInput(item)
      ? expandContainerInput(item, { fetchImpl }).then(items => ({ items }), error => ({ error }))
      : null;
    const run = () => expansion
      ? expansion.then(value => { if (value.error) throw value.error; return mutate(value.items); })
      : mutate(collectionItems ?? [item]);
    const result = !replacesPlayback && pendingQueueIntent ? pendingQueueIntent.then(run) : run();
    if (!replacesPlayback && result?.then) {
      const boundary = result.then(() => {}, () => {});
      pendingQueueIntent = boundary;
      boundary.then(() => { if (pendingQueueIntent === boundary) pendingQueueIntent = null; });
    }
    operations.set(operationId, result);
    return result;
  }
  return { execute, undo: ledger.undo, undoLedger: ledger };
}
