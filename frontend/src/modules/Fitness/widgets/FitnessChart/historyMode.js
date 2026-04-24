/**
 * computeHistorySnapshotAction — pure helper that decides what to do with
 * FitnessChart's persisted snapshot when `sessionId` changes.
 *
 * @param {string|null|undefined} prevSessionId
 * @param {string|null|undefined} nextSessionId
 * @param {boolean} isHistorical
 * @returns {{ action: 'keep'|'clear'|'enter-history' }}
 */
export function computeHistorySnapshotAction(prevSessionId, nextSessionId, isHistorical) {
  if (isHistorical) return { action: 'keep' };
  if (prevSessionId === nextSessionId) return { action: 'keep' };
  if (prevSessionId == null) return { action: 'keep' };
  if (nextSessionId == null) return { action: 'enter-history' };
  return { action: 'clear' };
}

export default computeHistorySnapshotAction;
