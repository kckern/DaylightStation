/**
 * Tell the School tablet a learner's day changed (`record-changed`): a
 * teacher correction or plan edit with no moment for the child in it. The
 * board re-reads those learners and their day is re-checked. Called after
 * the change is stored; best-effort, so a broken bus never undoes it.
 *
 * @param {{recordChanged?: Function}|null} realtime
 * @param {object|null} logger
 * @param {{learnerIds: string[], kind: string, studyDay?: string|null}} change
 *   `learnerIds: []` means the whole household.
 */
export function announceRecordChanged(realtime, logger, { learnerIds = [], kind, studyDay = null }) {
  if (!realtime?.recordChanged) return;
  try {
    realtime.recordChanged({ learnerIds, kind, ...(studyDay ? { studyDay } : {}) });
  } catch (err) {
    try { logger?.warn?.('school.record.broadcast-failed', { kind, learnerIds, error: err?.message ?? String(err) }); } catch { /* a broken logger changes nothing */ }
  }
}
