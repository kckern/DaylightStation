const idsOf = ids => [...new Set((ids || []).filter(id => id != null).map(String))].sort();
const reserved = operation => ['editing', 'pending', 'reconciling', 'error', 'conflict'].includes(operation.phase);

/** Session-owned intents. Reservations are synchronous, independent of React renders. */
export function createHealthOperations({ userId, durableStorage }) {
  const storagePrefix = `daylight.health.barcode-operations:${encodeURIComponent(userId)}:`;
  const receiptPrefix = `daylight.health.barcode-receipts:${encodeURIComponent(userId)}:`;
  const restored = new Map();
  const restoreReceipt = (key, op) => {
    if (key === receiptPrefix + op?.id && op?.userId === userId && op.kind === 'barcode-commit'
      && typeof op.receipt?.entryId === 'string' && op.receipt.entryId) {
      restored.set(op.id, { ...op, phase: 'succeeded', targetIds: [] });
    }
  };
  try {
    for (let index = 0; index < (durableStorage?.length || 0); index++) {
      const key = durableStorage.key(index);
      if (!key?.startsWith(storagePrefix) && !key?.startsWith(receiptPrefix)) continue;
      let operation;
      try { operation = JSON.parse(durableStorage.getItem(key)); }
      catch { continue; }
      if (key.startsWith(receiptPrefix)) { restoreReceipt(key, operation); continue; }
      if (restored.get(operation?.id)?.phase === 'succeeded') continue;
      if (operation?.userId !== userId || operation.kind !== 'barcode-commit' || key !== storagePrefix + operation.id ||
        operation.request?.path !== 'api/v1/health/nutrition/barcode-commit' ||
        operation.request?.method !== 'POST' || operation.request.body?.operationId !== operation.id) continue;
      restored.set(operation.id, {
        ...operation,
        targetIds: idsOf(Array.isArray(operation.targetIds) ? operation.targetIds : []),
        phase: 'error',
        error: 'Could not confirm this barcode log. Retry to check its result.',
      });
    }
    for (const operation of restored.values()) {
      if (operation.phase === 'succeeded') durableStorage?.removeItem(storagePrefix + operation.id);
    }
  } catch { /* Inaccessible storage will prevent the next durable intent from dispatching. */ }
  const persist = operation => {
    if (!durableStorage) throw new Error('Saving this barcode operation requires device storage.');
    durableStorage.setItem(storagePrefix + operation.id, JSON.stringify(operation));
  };
  const saveReceipt = operation => {
    const { id, date, bucket, startedAt, reversed, response, receipt, kind } = operation;
    const entryId = receipt?.entryId ?? response?.entryIds?.[0];
    const undoToken = receipt?.undoToken ?? response?.undoToken;
    if (typeof entryId !== 'string' || !entryId) return;
    durableStorage?.setItem(receiptPrefix + id, JSON.stringify({
      userId, id, date, bucket, startedAt, reversed, kind, receipt: { entryId, undoToken },
    }));
  };
  const forget = id => durableStorage?.removeItem(storagePrefix + id);
  let disposed = false;
  let snapshot = { userId, operations: restored, revision: 0 };
  const listeners = new Set();
  const publish = operations => {
    snapshot = { userId, operations, revision: snapshot.revision + 1 };
    listeners.forEach(listener => listener());
  };
  const owners = (ids, except) => [...snapshot.operations.values()].filter(op => op.id !== except && reserved(op)
    && op.targetIds.some(id => idsOf(ids).includes(id)));
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    get disposed() { return disposed; },
    isReserved: (ids, except) => owners(ids, except).length > 0,
    begin(intent) {
      if (disposed || snapshot.operations.has(intent.id)) return { ok: false };
      const targetIds = idsOf(intent.targetIds);
      const blockedBy = owners(targetIds, intent.parentId).map(op => op.id);
      if (blockedBy.length) return { ok: false, blockedBy };
      const op = { ...structuredClone(intent), targetIds, phase: intent.phase || 'pending', startedAt: Date.now(), userId };
      const operations = new Map(snapshot.operations).set(op.id, op);
      if (op.kind === 'barcode-commit') persist(op);
      publish(operations);
      return { ok: true, operationId: op.id };
    },
    markBarcodeUndone(token) {
      for (const op of snapshot.operations.values()) {
        if (op.kind === 'barcode-commit' && (op.receipt?.undoToken || op.response?.undoToken) === token) {
          this.transition(op.id, { reversed: true });
        }
      }
    },
    transition(id, patch) {
      if (disposed || !snapshot.operations.has(id)) return;
      const operations = new Map(snapshot.operations);
      const previous = operations.get(id);
      const next = { ...previous, ...patch, id: previous.id, userId, targetIds: previous.targetIds };
      operations.set(id, next);
      // Retain active/uncertain work; bound only fully retired history.
      const retired = [...operations.values()].filter(op => op.phase === 'succeeded');
      retired.sort((a, b) => a.startedAt - b.startedAt).slice(0, Math.max(0, retired.length - 50)).forEach(op => {
        operations.delete(op.id);
        if (op.kind === 'barcode-commit') {
          try { durableStorage?.removeItem(receiptPrefix + op.id); } catch { /* The receipt remains readable. */ }
        }
      });
      if (next.kind === 'barcode-commit') {
        try {
          if (next.phase === 'succeeded') {
            if (operations.has(id)) saveReceipt(next);
            forget(id);
          } else persist(next);
        } catch { /* The original request remains safe to replay. */ }
      }
      publish(operations);
    },
    discard(id, { descendants = false } = {}) {
      if (disposed) return;
      const next = new Map(snapshot.operations), removed = new Set([id]);
      if (descendants) {
        let changed = true;
        while (changed) { changed = false; for (const op of next.values()) if (removed.has(op.parentId) && !removed.has(op.id)) { removed.add(op.id); changed = true; } }
      }
      removed.forEach(key => next.delete(key));
      for (const key of removed) {
        if (snapshot.operations.get(key)?.kind !== 'barcode-commit') continue;
        try { forget(key); durableStorage?.removeItem(receiptPrefix + key); } catch { /* The original request remains safe to replay. */ }
      }
      publish(next);
    },
    dispose() { disposed = true; publish(new Map()); listeners.clear(); },
  };
}
