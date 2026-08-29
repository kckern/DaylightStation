/** Frames live in `_trash` for this long before they are hard-deleted (7 days). */
export const SESSION_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Use case: fitness session trash retention.
 *
 * The ONLY hard-delete in the session media lifecycle. A confirmed recap moves a
 * session's raw frames into `media/fitness/_trash/<date>/<id>/` (see
 * `YamlRecapSnapshotStore.moveToTrash`) instead of deleting them. This sweep walks
 * that `_trash` tree and permanently removes entries that have sat there longer
 * than the retention window, then prunes the emptied date dirs.
 *
 * Safety: it is constructed bound to the absolute `_trash` root and only ever
 * deletes paths it builds *under* that root — it can never reach the live
 * `sessions/` tree. Every entry's age is measured from its directory mtime, which
 * `moveToTrash` stamps to the moment the frames were trashed.
 */
export class TrashRetentionSweep {
  #d;
  constructor(deps) { this.#d = deps; }

  /**
   * @param {Object} [opts]
   * @param {number} [opts.now] - current time ms (injectable for tests)
   * @param {number} [opts.maxAgeMs] - retention window (defaults to 7 days)
   */
  async run({ now = Date.now(), maxAgeMs = SESSION_TRASH_RETENTION_MS } = {}) {
    const { trashStore, logger } = this.#d;
    const stats = { scanned: 0, deleted: 0, kept: 0, prunedDates: 0, errors: 0 };

    const batches = await trashStore.listRetentionBatches();
    if (batches == null) return stats;
    logger?.info?.('fitness.trash_sweep.start', { maxAgeMs });

    for (const { date, entries } of batches) {
      for (const entry of entries) {
        const { id } = entry;
        stats.scanned++;
        try {
          if (entry.error) throw entry.error;
          const ageMs = now - entry.trashedAt;
          if (ageMs >= maxAgeMs) {
            await trashStore.permanentlyDelete({ date, id });
            stats.deleted++;
            logger?.info?.('fitness.trash_sweep.deleted', { date, id, ageMs });
          } else {
            stats.kept++;
          }
        } catch (err) {
          stats.errors++;
          logger?.warn?.('fitness.trash_sweep.error', { date, id, error: err?.message });
        }
      }
      // Prune the date dir once empty.
      try {
        if (await trashStore.pruneBatchIfEmpty(date)) {
          stats.prunedDates++;
        }
      } catch (err) {
        stats.errors++;
        logger?.warn?.('fitness.trash_sweep.prune_failed', { date, error: err?.message });
      }
    }

    logger?.info?.('fitness.trash_sweep.done', { ...stats });
    return stats;
  }
}
