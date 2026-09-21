/** Owner-local undo records. A controller ACK never extends the tap deadline. */
export function createUndoLedger({ targetId, capture, revision, restore, now = Date.now }) {
  const records = new Map();
  const currentRevision = () => JSON.stringify(revision());
  const failure = (code) => ({ ok: false, code });
  const restoreRecord = async (record) => {
    if (record.appliedRevision !== currentRevision()) return failure('UNDO_SUPERSEDED');
    const snapshot = structuredClone(record.priorSnapshot);
    if (snapshot.currentItem?.isLive) snapshot.position = 0;
    const result = await restore(snapshot, record);
    if (result?.ok === false) return result;
    record.status = 'undone';
    return { ok: true, status: 'undone' };
  };
  return {
    get: operationId => records.get(operationId) ?? null,
    begin({ operationId, tappedAt = now() }) {
      if (records.has(operationId)) return records.get(operationId);
      const record = {
        operationId, targetId, priorSnapshot: capture(), appliedRevision: null,
        priorRevision: currentRevision(), expiresAt: tappedAt + 10000, status: 'pending',
      };
      records.set(operationId, record);
      return record;
    },
    canApply(operationId) {
      const record = records.get(operationId);
      if (!record || record.status !== 'pending') return false;
      if (record.priorRevision !== currentRevision()) { record.status = 'superseded'; return false; }
      return true;
    },
    applying(operationId, { playbackChanged = true } = {}) {
      const record = records.get(operationId);
      if (record?.status === 'pending') { record.status = 'applying'; record.playbackChanged = playbackChanged; }
    },
    issued(operationId) {
      const record = records.get(operationId);
      if (record && ['applying', 'undo-pending'].includes(record.status)) record.appliedRevision = currentRevision();
    },
    applied(operationId) {
      const record = records.get(operationId);
      if (!record || !['pending', 'applying', 'undo-pending'].includes(record.status)) return record;
      const undoRequested = record.status === 'undo-pending';
      record.appliedRevision ??= currentRevision();
      record.status = 'applied';
      if (undoRequested) return restoreRecord(record).then(() => record);
      return record;
    },
    async undo(operationId) {
      const record = records.get(operationId);
      // The cancel request may overtake delivery. Keep a tombstone so that
      // delayed original delivery can never resurrect a cancelled action.
      if (!record) {
        records.set(operationId, { operationId, targetId, priorSnapshot: null, appliedRevision: null, expiresAt: now() + 10000, status: 'cancelled' });
        return { ok: true, status: 'cancelled' };
      }
      if (['undone', 'cancelled'].includes(record.status)) return { ok: true, status: record.status };
      if (now() >= record.expiresAt) return failure('UNDO_EXPIRED');
      if (record.status === 'pending') { record.status = 'cancelled'; return { ok: true, status: 'cancelled' }; }
      if (['applying', 'undo-pending'].includes(record.status)) { record.status = 'undo-pending'; return { ok: true, status: 'undo-pending' }; }
      if (record.status !== 'applied' || record.appliedRevision !== currentRevision()) return failure('UNDO_SUPERSEDED');
      return restoreRecord(record);
    },
  };
}
