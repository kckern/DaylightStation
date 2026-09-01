import path from 'node:path';
import { IScreenshotStore } from '#apps/fitness/ports/IScreenshotStore.mjs';
import { ensureDir, writeBinary, fileExists, readBinary, readDirectory } from '#system/utils/FileIO.mjs';

export class FilesystemScreenshotStore extends IScreenshotStore {
  #sessionService;
  #logger;
  constructor({ sessionService, logger } = {}) {
    super();
    this.#sessionService = sessionService;
    this.#logger = logger || console;
  }
  async saveCapture({ sessionId, householdId, role, index, image, mediaType, timestamp }) {
    const layout = this.#sessionService.getStoragePaths(sessionId, householdId);
    if (!layout) return null;
    const encoded = typeof image === 'string' ? image.replace(/^data:[^;]+;base64,/, '') : '';
    if (!encoded) return { kind: 'invalid_encoding', reason: 'empty' };
    const bytes = Buffer.from(encoded, 'base64');
    if (!bytes.length) return { kind: 'invalid_encoding', reason: 'decode_failed' };
    const normalizedMime = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';
    const extension = normalizedMime.includes('png') ? 'png'
      : normalizedMime.includes('webp') ? 'webp'
      : 'jpg';
    const indexValue = Number.isFinite(index) ? Number(index) : null;
    const indexFragment = indexValue != null ? String(indexValue).padStart(4, '0') : Date.now().toString(36);
    const rolePrefix = role === 'player' ? 'player_' : '';
    const nameFor = (frag) => `${layout.sessionDate}_${rolePrefix}${frag}.${extension}`;
    ensureDir(layout.screenshotsDir);

    // A capture loop that restarts mid-session replays index 0..N. Since the filename
    // is derived only from date+role+index, that replay would overwrite the earlier
    // run's frames AND evict their manifest rows (SessionService dedupes by filename),
    // silently destroying footage. Only an identical re-send of the SAME frame may
    // overwrite in place; a genuinely different image is relocated to a free slot.
    let filename = nameFor(indexFragment);
    let storedIndex = indexValue;
    const target = path.join(layout.screenshotsDir, filename);
    if (fileExists(target) && !bytesMatch(target, bytes)) {
      const nextIndex = this.#nextFreeIndex(layout.screenshotsDir, layout.sessionDate, rolePrefix, extension);
      const relocated = nameFor(String(nextIndex).padStart(4, '0'));
      this.#logger.warn?.('fitness.screenshot.index_collision', {
        sessionId, role, requestedIndex: indexValue, assignedIndex: nextIndex,
        existing: filename, relocated,
      });
      filename = relocated;
      storedIndex = nextIndex;
    }

    writeBinary(path.join(layout.screenshotsDir, filename), bytes);
    const capturedAt = timestamp || Date.now();
    await this.#sessionService.addSnapshot(sessionId, {
      index: storedIndex, filename, path: `${layout.screenshotsRelativeBase}/${filename}`,
      timestamp: capturedAt, size: bytes.length, role,
    }, householdId, capturedAt);
    return {
      kind: 'stored', sessionRef: layout.sessionDate.replace(/-/g, '') + (sessionId.slice(8) || ''),
      capture: {
        order: storedIndex, resourceName: filename,
        resourceRef: `${layout.screenshotsRelativeBase}/${filename}`,
        capturedAt, byteLength: bytes.length, role, mediaType: normalizedMime || 'image/jpeg',
      },
    };
  }

  /**
   * First index past every frame already stored for this role. One readdir beats
   * probing upward — a restart collides for its whole replayed range, not just once.
   */
  #nextFreeIndex(dir, sessionDate, rolePrefix, extension) {
    const pattern = new RegExp(`^${escapeRe(sessionDate)}_${escapeRe(rolePrefix)}(\\d{4,})\\.`);
    let max = -1;
    for (const entry of readDirectory(dir) || []) {
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (!name) continue;
      // Camera files carry no role prefix, so they must not swallow `..._player_0001`.
      if (!rolePrefix && /_player_/.test(name)) continue;
      const m = pattern.exec(name);
      if (m) max = Math.max(max, Number(m[1]));
    }
    return max + 1;
  }
}

function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function bytesMatch(filePath, bytes) {
  try {
    const existing = readBinary(filePath);
    return Buffer.isBuffer(existing) && existing.equals(bytes);
  } catch {
    return false;
  }
}
