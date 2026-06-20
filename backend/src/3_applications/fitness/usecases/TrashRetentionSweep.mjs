import path from 'node:path';

/** Frames live in `_trash` for this long before they are hard-deleted (7 days). */
export const SESSION_TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Use case: fitness session trash retention.
 *
 * The ONLY hard-delete in the session media lifecycle. A confirmed recap moves a
 * session's raw frames into `media/apps/fitness/_trash/<date>/<id>/` (see
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
    const { trashDir, fileIO, logger } = this.#d;
    const stats = { scanned: 0, deleted: 0, kept: 0, prunedDates: 0, errors: 0 };

    if (!trashDir || !fileIO.existsSync(trashDir)) return stats;
    logger?.info?.('fitness.trash_sweep.start', { trashDir, maxAgeMs });

    for (const date of subdirs(fileIO, trashDir)) {
      const dateDir = path.join(trashDir, date);
      for (const id of subdirs(fileIO, dateDir)) {
        const entry = path.join(dateDir, id);
        stats.scanned++;
        // Hard guard: never act outside the trash root.
        if (!entry.startsWith(trashDir + path.sep)) continue;
        try {
          const ageMs = now - mtimeMs(fileIO, entry);
          if (ageMs >= maxAgeMs) {
            fileIO.rmSync(entry, { recursive: true, force: true });
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
        if (subdirs(fileIO, dateDir).length === 0) {
          fileIO.rmSync(dateDir, { recursive: true, force: true });
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

function subdirs(fileIO, dir) {
  try {
    return fileIO.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name);
  } catch { return []; }
}

function mtimeMs(fileIO, p) {
  return fileIO.statSync(p).mtimeMs || 0;
}
