import path from 'node:path';
import { IScreenshotStore } from '#apps/fitness/ports/IScreenshotStore.mjs';
import { ensureDir, writeBinary } from '#system/utils/FileIO.mjs';

export class FilesystemScreenshotStore extends IScreenshotStore {
  #sessionService;
  constructor({ sessionService }) { super(); this.#sessionService = sessionService; }
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
    const filename = `${layout.sessionDate}_${rolePrefix}${indexFragment}.${extension}`;
    ensureDir(layout.screenshotsDir);
    writeBinary(path.join(layout.screenshotsDir, filename), bytes);
    const capturedAt = timestamp || Date.now();
    await this.#sessionService.addSnapshot(sessionId, {
      index: indexValue, filename, path: `${layout.screenshotsRelativeBase}/${filename}`,
      timestamp: capturedAt, size: bytes.length, role,
    }, householdId, capturedAt);
    return {
      kind: 'stored', sessionRef: layout.sessionDate.replace(/-/g, '') + (sessionId.slice(8) || ''),
      capture: {
        order: indexValue, resourceName: filename,
        resourceRef: `${layout.screenshotsRelativeBase}/${filename}`,
        capturedAt, byteLength: bytes.length, role, mediaType: normalizedMime || 'image/jpeg',
      },
    };
  }
}
