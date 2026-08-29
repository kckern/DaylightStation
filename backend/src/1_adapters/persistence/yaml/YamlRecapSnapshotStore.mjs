import path from 'node:path';
import { IRecapSnapshotStore } from '#apps/fitness/ports/IRecapSnapshotStore.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import {
  deleteDirAsync,
  ensureDirAsync,
  fileExists,
  readBinaryFromPathAsync,
  renameFileAsync,
  setFileTimes,
} from '#system/utils/FileIO.mjs';

const captureLocations = new WeakMap();

/**
 * Reads and cleans up the raw webcam capture frames recorded during a session.
 * Reuses the session datastore's storage-path resolution (screenshotsDir) and the
 * session's `snapshots.captures` records for ordering/timestamps.
 */
export class YamlRecapSnapshotStore extends IRecapSnapshotStore {
  #datastore;
  #logger;

  constructor({ sessionDatastore, logger = console }) {
    super();
    if (!sessionDatastore) {
      throw new InfrastructureError('YamlRecapSnapshotStore requires sessionDatastore', { code: 'MISSING_DEPENDENCY' });
    }
    this.#datastore = sessionDatastore;
    this.#logger = logger;
  }

  async listCaptures(sessionId, householdId) {
    const paths = this.#datastore.getStoragePaths(sessionId, householdId);
    const screenshotsDir = paths?.screenshotsDir;
    const data = await this.#datastore.findById(sessionId, householdId);
    const captures = data?.snapshots?.captures || [];
    const resolved = captures
      .map(c => {
        const absolutePath = this.#resolve(screenshotsDir, c);
        if (!absolutePath) return null;
        const captureId = Object.freeze({ kind: 'recap-capture' });
        captureLocations.set(captureId, absolutePath);
        return {
          index: c.index,
          filename: c.filename,
          timestamp: c.timestamp,
          role: c.role || 'camera',
          captureId,
        };
      })
      .filter(Boolean)
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

  async readCapture(captureId) {
    const absolutePath = captureLocations.get(captureId);
    if (!absolutePath) throw new InfrastructureError('readCapture requires a valid capture id', { code: 'INVALID_CAPTURE_ID' });
    return readBinaryFromPathAsync(absolutePath);
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
    if (!screenshotsDir || !this.#exists(screenshotsDir)) return null;
    if (!trashDir) {
      throw new InfrastructureError('moveToTrash requires a trashDir from storage paths', { code: 'MISSING_TRASH_DIR' });
    }
    try {
      const dest = path.join(trashDir, 'screenshots');
      // Clear any stale trash entry for this session, then move the frames in.
      await this.#removeDir(trashDir);
      await this.#ensureDir(trashDir);
      await this.#rename(screenshotsDir, dest);
      // Stamp the trash entry so retention ages it from when it was trashed.
      const t = new Date(now);
      try { this.#setTimes(trashDir, t, t); } catch { /* mtime stamp best-effort */ }
      this.#logger.debug?.('recap.snapshots.trashed', { sessionId, dest });
      return dest;
    } catch (err) {
      throw new InfrastructureError(`recap snapshot move-to-trash failed: ${err.message}`, { code: 'TRASH_FAILED' });
    }
  }

  async cleanup(sessionId, householdId, { archive = false } = {}) {
    const paths = this.#datastore.getStoragePaths(sessionId, householdId);
    const screenshotsDir = paths?.screenshotsDir;
    if (!screenshotsDir || !this.#exists(screenshotsDir)) return;
    try {
      if (archive) {
        const dest = path.join(path.dirname(screenshotsDir), 'screenshots_archive');
        await this.#removeDir(dest);
        await this.#rename(screenshotsDir, dest);
        this.#logger.debug?.('recap.snapshots.archived', { sessionId, dest });
      } else {
        await this.#removeDir(screenshotsDir);
        this.#logger.debug?.('recap.snapshots.deleted', { sessionId, screenshotsDir });
      }
    } catch (err) {
      throw new InfrastructureError(`recap snapshot cleanup failed: ${err.message}`, { code: 'CLEANUP_FAILED' });
    }
  }

  // Prefer the recorded absolute/relative path; fall back to dir + filename.
  #resolve(screenshotsDir, capture) {
    if (capture.path && path.isAbsolute(capture.path) && this.#exists(capture.path)) return capture.path;
    if (screenshotsDir && capture.filename) {
      const p = path.join(screenshotsDir, capture.filename);
      if (this.#exists(p)) return p;
    }
    if (capture.path && this.#exists(capture.path)) return capture.path;
    return null;
  }

  #exists(filePath) { return fileExists(filePath); }
  #removeDir(dirPath) { return deleteDirAsync(dirPath, { force: true }); }
  #ensureDir(dirPath) { return ensureDirAsync(dirPath); }
  #rename(sourcePath, destinationPath) { return renameFileAsync(sourcePath, destinationPath); }
  #setTimes(filePath, atime, mtime) { return setFileTimes(filePath, atime, mtime); }
}
