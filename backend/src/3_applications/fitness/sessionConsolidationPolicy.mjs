/**
 * Session consolidation policy — the single source of truth for "when is a
 * fitness session still eligible to be resumed/merged, and when has it settled?"
 *
 * An interrupted workout that is resumed (or manually stitched) shortly after
 * is treated as ONE session: `findResumable` offers any non-finalized session
 * that ended within this window, and `mergeSessions` folds fragments together.
 * The time-lapse recap must obey the SAME assumptions — it renders frames and
 * then DELETES the raw captures (snapshotStore.cleanup), so generating a recap
 * before a session has settled would destroy the frames a later resume/merge
 * needs. Both consumers import this so the window can never drift apart.
 */

/** A session may still be resumed/merged for this long after it ends (30 min). */
export const SESSION_RESUME_MERGE_WINDOW_MS = 30 * 60 * 1000;

/**
 * Has a session settled enough to safely render its recap (and clean up frames)?
 *
 * Settled iff it was explicitly finalized (a "clean split" the consolidation
 * functions will never merge) OR it ended longer ago than the resume/merge
 * window. A session that has not ended at all, or ended within the window, is
 * still open for consolidation and must NOT be recapped yet.
 *
 * @param {Object} args
 * @param {boolean} args.finalized   - the session's `finalized` flag
 * @param {number|string|null} args.endTime - ms epoch (or date string); null/0 if still active
 * @param {number} [args.now]        - current time (ms); injectable for tests
 * @param {number} [args.windowMs]   - override the window (defaults to the shared constant)
 * @returns {{ settled: boolean, reason: string, msSinceEnd: number|null }}
 */
export function evaluateRecapReadiness({ finalized, endTime, now = Date.now(), windowMs = SESSION_RESUME_MERGE_WINDOW_MS }) {
  if (finalized) return { settled: true, reason: 'finalized', msSinceEnd: null };

  const endMs = typeof endTime === 'number'
    ? endTime
    : (endTime ? new Date(endTime).getTime() : 0);
  if (!endMs || Number.isNaN(endMs)) {
    return { settled: false, reason: 'not-ended', msSinceEnd: null };
  }

  const msSinceEnd = now - endMs;
  if (msSinceEnd < windowMs) {
    return { settled: false, reason: 'within-merge-window', msSinceEnd };
  }
  return { settled: true, reason: 'merge-window-elapsed', msSinceEnd };
}

/**
 * Should an abandoned "skeleton" session be reaped (deleted)?
 *
 * The always-on camera/player screenshot capture creates a session record
 * (SessionService.addSnapshot → `new Session`) even when no rider ever tags in.
 * If no participant joins, PersistenceManager refuses to persist the session (the
 * roster gate, "no-participants"), so `endTime`/`finalized` are never written —
 * the skeleton is left with `endTime: null` forever. The recap sweep then defers
 * it on every tick (reason `not-ended`) while its captured frames leak on disk.
 * Such a record can never be recapped (no workout data) nor resumed (no roster),
 * so once its capture has stopped past the resume/merge window, reap it.
 *
 * Reap iff ALL hold: not finalized, never ended (`endTime` null), empty roster,
 * and last capture older than the window. Any participant, an `endTime`, recent
 * capture activity, or unknown activity (no timestamp to age out) → leave it
 * alone: it is either a real session, still live, or unassessable.
 *
 * @param {Object} args
 * @param {boolean} args.finalized
 * @param {number|string|null} args.endTime    - ms epoch / date string; null if never ended
 * @param {number} args.rosterSize             - number of persisted participants
 * @param {number|null} args.lastCaptureMs     - ms epoch of the most recent capture
 * @param {number} [args.now]                  - current time (ms); injectable for tests
 * @param {number} [args.windowMs]             - staleness window (defaults to the shared constant)
 * @returns {{ reap: boolean, reason: string }}
 */
export function evaluateAbandonedSkeleton({ finalized, endTime, rosterSize, lastCaptureMs, now = Date.now(), windowMs = SESSION_RESUME_MERGE_WINDOW_MS }) {
  if (finalized) return { reap: false, reason: 'finalized' };

  const endMs = typeof endTime === 'number' ? endTime : (endTime ? new Date(endTime).getTime() : 0);
  if (endMs && !Number.isNaN(endMs)) return { reap: false, reason: 'ended' };

  if (rosterSize > 0) return { reap: false, reason: 'has-roster' };
  if (!Number.isFinite(lastCaptureMs)) return { reap: false, reason: 'no-capture-activity' };
  if (now - lastCaptureMs < windowMs) return { reap: false, reason: 'recently-active' };

  return { reap: true, reason: 'abandoned-skeleton' };
}

/** Recap statuses that mean the raw frames will never be (re)rendered. */
const TERMINAL_RECAP_STATUS = new Set(['ready', 'skipped']);

/**
 * Classify a fitness session's media dir (`sessions/<date>/<id>/`) for the
 * garbage collector. Pure: callers gather the disk + session facts and execute
 * the returned action.
 *
 * Actions:
 * - `prune-empty`    — no frame files left (a post-cleanup shell); delete the dir.
 * - `delete-orphan`  — frames present but no session record owns them; delete the dir.
 * - `delete-frames`  — frames belong to a settled session that is done with them
 *                      (recap succeeded, terminally skipped, or un-recappable because
 *                      it has no camera hero); delete the frames, keep the record.
 * - `keep`           — still live, still recappable, or too recent to touch.
 *
 * The window guards protect against racing a live capture: a brand-new empty dir
 * or an orphan whose session YAML hasn't landed yet is left alone until it ages out.
 *
 * @param {Object} args
 * @param {boolean} args.hasFiles          - any frame file present under the dir
 * @param {boolean} [args.hasCameraFrames] - any non-player (camera) frame present
 * @param {boolean} [args.sessionExists]   - a session record owns this dir
 * @param {boolean} [args.finalized]       - session.finalized
 * @param {number|string|null} [args.endTime] - session end (ms epoch / date string)
 * @param {string|null} [args.timelapseStatus] - session.timelapse?.status
 * @param {number} args.dirAgeMs           - age (ms) of the dir's most recent change
 * @param {number} [args.now]
 * @param {number} [args.windowMs]
 * @returns {{ action: 'keep'|'prune-empty'|'delete-orphan'|'delete-frames', reason: string }}
 */
export function classifySessionMediaDir({
  hasFiles, hasCameraFrames = false, sessionExists = false,
  finalized = false, endTime = null, timelapseStatus = null,
  dirAgeMs, now = Date.now(), windowMs = SESSION_RESUME_MERGE_WINDOW_MS
}) {
  if (!hasFiles) {
    return dirAgeMs >= windowMs
      ? { action: 'prune-empty', reason: 'empty-shell' }
      : { action: 'keep', reason: 'empty-recent' };
  }

  if (!sessionExists) {
    return dirAgeMs >= windowMs
      ? { action: 'delete-orphan', reason: 'orphan-frames' }
      : { action: 'keep', reason: 'orphan-recent' };
  }

  const { settled } = evaluateRecapReadiness({ finalized, endTime, now, windowMs });
  if (!settled) return { action: 'keep', reason: 'session-active' };

  if (TERMINAL_RECAP_STATUS.has(timelapseStatus)) {
    return { action: 'delete-frames', reason: timelapseStatus === 'ready' ? 'post-recap-leftover' : 'terminal-skipped' };
  }
  if (!hasCameraFrames) {
    return { action: 'delete-frames', reason: 'no-camera-unrecappable' };
  }
  // Settled, has a camera hero, recap not yet terminal (null/failed) → the recap
  // sweep still owns it (renders or retries). Leave the frames in place.
  return { action: 'keep', reason: 'recap-pending' };
}
