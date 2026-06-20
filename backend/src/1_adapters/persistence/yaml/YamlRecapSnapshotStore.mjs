import path from 'node:path';
import nodeFs from 'node:fs';
import { IRecapSnapshotStore } from '#apps/fitness/ports/IRecapSnapshotStore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Reads and cleans up the raw webcam capture frames recorded during a session.
 * Reuses the session datastore's storage-path resolution (screenshotsDir) and the
 * session's `snapshots.captures` records for ordering/timestamps.
 */
export class YamlRecapSnapshotStore extends IRecapSnapshotStore {
  #datastore;
  #fs;
  #logger;

  constructor({ sessionDatastore, fileIO = nodeFs, logger = console }) {
    super();
    if (!sessionDatastore) {
      throw new InfrastructureError('YamlRecapSnapshotStore requires sessionDatastore', { code: 'MISSING_DEPENDENCY' });
    }
    this.#datastore = sessionDatastore;
    this.#fs = fileIO;
    this.#logger = logger;
  }

  async listCaptures(sessionId, householdId) {
    const paths = this.#datastore.getStoragePaths(sessionId, householdId);
    const screenshotsDir = paths?.screenshotsDir;
    const data = await this.#datastore.findById(sessionId, householdId);
    const captures = data?.snapshots?.captures || [];
    const resolved = captures
      .map(c => ({
        index: c.index,
        filename: c.filename,
        timestamp: c.timestamp,
        role: c.role || 'camera',
        absolutePath: this.#resolve(screenshotsDir, c)
      }))
      .filter(c => c.absolutePath)
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    const missing = captures.length - resolved.length;
    this.#logger.debug?.('recap.snapshots.listed', {
      sessionId, total: captures.length, resolved: resolved.length,
      camera: resolved.filter(c => c.role === 'camera').length,
      player: resolved.filter(c => c.role === 'player').length,
      missingFiles: missing
    });
    if (missing > 0) {
      this.#logger.warn?.('recap.snapshots.missing_files', { sessionId, missingFiles: missing, total: captures.length });
    }
    return resolved;
  }

  async readCapture(absolutePath) {
    if (!absolutePath) throw new InfrastructureError('readCapture requires a path', { code: 'MISSING_PATH' });
    return this.#fs.promises
      ? this.#fs.promises.readFile(absolutePath)
      : this.#fs.readFileSync(absolutePath);
  }

  /**
   * Soft-delete a session's raw frames: MOVE the screenshots dir into the media
   * `_trash` (never a hard `rm`). The recap MP4 is the durable artifact; the raw
   * frames are kept recoverable in `_trash` and only hard-deleted later by the
   * trash-retention sweep once they age past its window. The trash entry's mtime
   * is stamped to `now` so retention measures "time since trashed", not the
   * original frame time.
   *
   * @returns {Promise<string|null>} the trash destination, or null if nothing moved.
   */
  async moveToTrash(sessionId, householdId, { now = Date.now() } = {}) {
    const paths = this.#datastore.getStoragePaths(sessionId, householdId);
    const screenshotsDir = paths?.screenshotsDir;
    const trashDir = paths?.trashDir;
    if (!screenshotsDir || !this.#fs.existsSync(screenshotsDir)) return null;
    if (!trashDir) {
      throw new InfrastructureError('moveToTrash requires a trashDir from storage paths', { code: 'MISSING_TRASH_DIR' });
    }
    try {
      const dest = path.join(trashDir, 'screenshots');
      // Clear any stale trash entry for this session, then move the frames in.
      this.#fs.rmSync(trashDir, { recursive: true, force: true });
      this.#fs.mkdirSync(trashDir, { recursive: true });
      this.#fs.renameSync(screenshotsDir, dest);
      // Stamp the trash entry so retention ages it from when it was trashed.
      const t = new Date(now);
      try { this.#fs.utimesSync(trashDir, t, t); } catch { /* mtime stamp best-effort */ }
      this.#logger.debug?.('recap.snapshots.trashed', { sessionId, dest });
      return dest;
    } catch (err) {
      throw new InfrastructureError(`recap snapshot move-to-trash failed: ${err.message}`, { code: 'TRASH_FAILED' });
    }
  }

  async cleanup(sessionId, householdId, { archive = false } = {}) {
    const paths = this.#datastore.getStoragePaths(sessionId, householdId);
    const screenshotsDir = paths?.screenshotsDir;
    if (!screenshotsDir || !this.#fs.existsSync(screenshotsDir)) return;
    try {
      if (archive) {
        const dest = path.join(path.dirname(screenshotsDir), 'screenshots_archive');
        this.#fs.rmSync(dest, { recursive: true, force: true });
        this.#fs.renameSync(screenshotsDir, dest);
        this.#logger.debug?.('recap.snapshots.archived', { sessionId, dest });
      } else {
        this.#fs.rmSync(screenshotsDir, { recursive: true, force: true });
        this.#logger.debug?.('recap.snapshots.deleted', { sessionId, screenshotsDir });
      }
    } catch (err) {
      throw new InfrastructureError(`recap snapshot cleanup failed: ${err.message}`, { code: 'CLEANUP_FAILED' });
    }
  }

  // Prefer the recorded absolute/relative path; fall back to dir + filename.
  #resolve(screenshotsDir, capture) {
    if (capture.path && path.isAbsolute(capture.path) && this.#fs.existsSync(capture.path)) return capture.path;
    if (screenshotsDir && capture.filename) {
      const p = path.join(screenshotsDir, capture.filename);
      if (this.#fs.existsSync(p)) return p;
    }
    if (capture.path && this.#fs.existsSync(capture.path)) return capture.path;
    return null;
  }
}
