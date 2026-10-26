const idsOf = ids => [...new Set((ids || []).filter(id => id != null).map(String))].sort();
const reserved = operation => !['succeeded', 'dismissed'].includes(operation.phase);

/** Session-owned intents. Reservations are synchronous, independent of React renders. */
export function createHealthOperations({ userId }) {
  let disposed = false;
  let snapshot = { userId, operations: new Map(), revision: 0 };
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
      const blockedBy = owners(targetIds).map(op => op.id);
      if (blockedBy.length) return { ok: false, blockedBy };
      const op = { ...structuredClone(intent), targetIds, phase: intent.phase || 'pending', startedAt: Date.now(), userId };
      publish(new Map(snapshot.operations).set(op.id, op));
      return { ok: true, operationId: op.id };
    },
    transition(id, patch) {
      if (disposed || !snapshot.operations.has(id)) return;
      const operations = new Map(snapshot.operations);
      const previous = operations.get(id);
      const next = { ...previous, ...patch, id: previous.id, userId, targetIds: previous.targetIds };
      operations.set(id, next);
      // Retain active/uncertain work; bound only fully retired history.
      const retired = [...operations.values()].filter(op => op.phase === 'succeeded');
      retired.slice(0, Math.max(0, retired.length - 50)).forEach(op => operations.delete(op.id));
      publish(operations);
    },
    discard(id) { if (!disposed) { const next = new Map(snapshot.operations); next.delete(id); publish(next); } },
    dispose() { disposed = true; publish(new Map()); listeners.clear(); },
  };
}
