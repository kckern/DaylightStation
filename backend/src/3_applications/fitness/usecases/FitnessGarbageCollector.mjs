import { classifySessionMediaDir } from '../sessionConsolidationPolicy.mjs';

/**
 * Use case: fitness session media garbage collector.
 *
 * The recap sweep is the safety net for *recapping* sessions; this is the janitor
 * for the raw frame store left behind on disk. It walks every
 * `media/apps/fitness/sessions/<date>/<id>/` dir and cleans the loose ends the
 * recap pipeline doesn't:
 *
 *  - **empty leftover shells** — a dir whose `screenshots/` was cleaned after a
 *    successful recap, leaving an empty `<id>/` husk.
 *  - **orphan frames** — a frame dir with no session record owning it (a true
 *    leak; should be rare, but guarded).
 *  - **un-recappable / done-with frames** — frames belonging to a *settled* real
 *    session that will never (re)render: a recap already succeeded, was terminally
 *    skipped, or the session captured no camera hero (player-only) so the
 *    camera-centric recap can't run. The frames are freed; the session record and
 *    its summary/stats are left untouched (this never writes to the data volume).
 *
 * Every decision lives in the pure `classifySessionMediaDir` policy; this use case
 * only gathers disk facts, looks up the owning session, and executes deletions.
 * Window guards in the policy keep it from racing a live capture. It runs on the
 * same scheduler tick as the recap sweep (Docker/prod-gated), after reaping, so
 * abandoned skeletons are already gone before the media walk.
 */
export class FitnessGarbageCollector {
  #d;
  constructor(deps) { this.#d = deps; }

  /**
   * @param {Object} [opts]
   * @param {string} [opts.householdId]
   * @param {number} [opts.now] - current time ms (injectable for tests)
   */
  async run({ householdId, now = Date.now() } = {}) {
    const { mediaFs, sessionService, configService, logger } = this.#d;
    const hid = householdId || configService?.getDefaultHouseholdId?.() || undefined;

    const stats = { scanned: 0, prunedEmpty: 0, deletedOrphans: 0, deletedFrames: 0, kept: 0, prunedDates: 0, errors: 0 };
    logger?.info?.('fitness.gc.start', { householdId: hid || null });

    let dates;
    try { dates = mediaFs.listDates(); }
    catch (err) { logger?.warn?.('fitness.gc.list_failed', { error: err?.message }); return stats; }

    for (const date of dates || []) {
      let sessions;
      try { sessions = mediaFs.listSessions(date); }
      catch (err) { stats.errors++; logger?.warn?.('fitness.gc.list_sessions_failed', { date, error: err?.message }); continue; }

      for (const id of sessions || []) {
        stats.scanned++;
        try {
          const files = mediaFs.frameFiles(date, id) || [];
          const hasFiles = files.length > 0;
          const hasCameraFrames = files.some(isCameraFrame);
          const dirAgeMs = now - (mediaFs.newestMtimeMs(date, id) || 0);

          let session = null;
          try { session = await sessionService.getSession(id, hid); } catch { session = null; }

          const decision = classifySessionMediaDir({
            hasFiles, hasCameraFrames,
            sessionExists: !!session,
            finalized: session?.finalized,
            endTime: session?.endTime,
            timelapseStatus: session?.timelapse?.status || null,
            dirAgeMs, now
          });

          if (decision.action === 'keep') { stats.kept++; continue; }

          mediaFs.deleteDir(date, id);
          if (decision.action === 'prune-empty') stats.prunedEmpty++;
          else if (decision.action === 'delete-orphan') stats.deletedOrphans++;
          else if (decision.action === 'delete-frames') stats.deletedFrames++;
          logger?.info?.('fitness.gc.cleaned', { sessionId: id, date, action: decision.action, reason: decision.reason });
        } catch (err) {
          stats.errors++;
          logger?.warn?.('fitness.gc.error', { sessionId: id, date, error: err?.message });
        }
      }

      // Prune the date dir once its last session dir is gone.
      try {
        if (mediaFs.isEmptyDate(date)) { mediaFs.deleteDate(date); stats.prunedDates++; }
      } catch (err) {
        stats.errors++;
        logger?.warn?.('fitness.gc.prune_date_failed', { date, error: err?.message });
      }
    }

    logger?.info?.('fitness.gc.done', { householdId: hid || null, ...stats });
    return stats;
  }
}

/** A camera (webcam) frame is any frame file that isn't a player-video capture. */
function isCameraFrame(name) {
  return /\.(jpe?g|png|webp)$/i.test(name) && !/_player_/i.test(name);
}
