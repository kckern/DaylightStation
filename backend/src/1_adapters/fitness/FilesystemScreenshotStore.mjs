import path from 'node:path';
import { IScreenshotStore } from '#apps/fitness/ports/IScreenshotStore.mjs';
import { ensureDir, writeBinary, fileExists, readBinary, readDirectory } from '#system/utils/FileIO.mjs';

export class FilesystemScreenshotStore extends IScreenshotStore {
  #sessionService;
  #kioskScreenshotDir;
  #logger;
  /**
   * @param {Object} deps
   * @param {Object} deps.sessionService
   * @param {string} [deps.kioskScreenshotDir] - root for keypad screenshots, e.g. media/logs/fitness/screenshots
   * @param {Object} [deps.logger]
   */
  constructor({ sessionService, kioskScreenshotDir = null, logger } = {}) {
    super();
    this.#sessionService = sessionService;
    this.#kioskScreenshotDir = kioskScreenshotDir;
    this.#logger = logger || console;
  }

  /**
   * Write a whole-screen kiosk capture to `<root>/<YYYY-MM-DD>/<HHMMSS>_<device>.<ext>`,
   * dated in the server's local time so it lines up with the session logs beside it.
   */
  async saveKioskCapture({ deviceId, image, mediaType, capturedAt }) {
    if (!this.#kioskScreenshotDir) return { kind: 'unconfigured' };
    const { bytes, reason } = decodeImage(image);
    if (!bytes) return { kind: 'invalid_encoding', reason };
    const normalizedMime = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';
    const extension = extensionFor(normalizedMime);
    const device = /^[a-z0-9_-]{1,64}$/i.test(String(deviceId || '')) ? String(deviceId) : 'unknown';
    const when = new Date(Number.isFinite(capturedAt) ? capturedAt : Date.now());
    const pad = (n) => String(n).padStart(2, '0');
    const day = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
    const clock = `${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
    const dir = path.join(this.#kioskScreenshotDir, day);
    ensureDir(dir);
    // Two presses inside one second must not overwrite each other.
    let filename = `${clock}_${device}.${extension}`;
    for (let n = 2; fileExists(path.join(dir, filename)); n += 1) {
      filename = `${clock}_${device}-${n}.${extension}`;
    }
    const fullPath = path.join(dir, filename);
    writeBinary(fullPath, bytes);
    return {
      kind: 'stored',
      capture: {
        resourceName: filename, day, resourcePath: fullPath,
        capturedAt: when.getTime(), byteLength: bytes.length, deviceId: device,
        mediaType: normalizedMime || 'image/jpeg',
      },
    };
  }
  async saveCapture({ sessionId, householdId, role, index, image, mediaType, timestamp }) {
    const layout = this.#sessionService.getStoragePaths(sessionId, householdId);
    if (!layout) return null;
    const { bytes, reason } = decodeImage(image);
    if (!bytes) return { kind: 'invalid_encoding', reason };
    const normalizedMime = typeof mediaType === 'string' ? mediaType.toLowerCase() : '';
    const extension = extensionFor(normalizedMime);
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

function decodeImage(image) {
  const encoded = typeof image === 'string' ? image.replace(/^data:[^;]+;base64,/, '') : '';
  if (!encoded) return { bytes: null, reason: 'empty' };
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length) return { bytes: null, reason: 'decode_failed' };
  return { bytes, reason: null };
}

function extensionFor(normalizedMime) {
  return normalizedMime.includes('png') ? 'png'
    : normalizedMime.includes('webp') ? 'webp'
    : 'jpg';
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
