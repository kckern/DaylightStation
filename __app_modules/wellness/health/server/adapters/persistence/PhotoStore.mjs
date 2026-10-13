/**
 * PhotoStore - persists captured food photos + best-effort thumbnails
 * @module adapters/persistence/PhotoStore
 *
 * Storage layout (per user, via `dataService.user.resolveDir`):
 *   users/{userId}/lifelog/nutrition/photos/{photoRef}.jpg
 *   users/{userId}/lifelog/nutrition/photos/{photoRef}.thumb.jpg   (best-effort)
 *
 * `sharp` is NOT in this project's dependency tree; `jimp` (^1.6.0) is, and is
 * used here to produce the thumbnail. If jimp fails to decode a given buffer
 * (corrupt bytes, an unsupported format, etc.) the ORIGINAL is still saved —
 * `save()` never fails because a thumbnail could not be produced — and
 * `resolvePath(..., { size: 'thumb' })` falls back to serving the original.
 *
 * Security: `photoRef` arrives from adapter callers or (indirectly, via the
 * serving route) a URL path segment. Every path built from it is gated by a
 * strict allowlist BEFORE any join, and by a resolved-path containment check
 * AFTER the join — belt and braces, so a loosened regex alone can't reopen
 * traversal.
 *
 * Privacy / retention: photos are private to the user's own data directory
 * and are never deleted here. A photo may be referenced by more than one
 * entry (PRD F2.5) — this module intentionally has NO delete method.
 */

import path from 'node:path';
import { Jimp } from 'jimp';
import { ensureDir, writeBinaryExclusive, fileExists } from '#system/utils/FileIO.mjs';
import { shortId } from '#system/utils/id.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/** The ONLY shape a valid photoRef may take. Never loosened. */
export const PHOTO_REF_PATTERN = /^ph_[A-Za-z0-9]+$/;

export function isValidPhotoRef(photoRef) {
  return typeof photoRef === 'string' && PHOTO_REF_PATTERN.test(photoRef);
}

const THUMBNAIL_WIDTH = 320;
const PHOTOS_RELATIVE_DIR = 'lifelog/nutrition/photos';

export class PhotoStore {
  #dataService;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.dataService - DataService instance (uses .user.resolveDir)
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    if (!options.dataService) {
      throw new InfrastructureError('PhotoStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = options.dataService;
    this.#logger = options.logger || console;
  }

  #getDir(userId) {
    return this.#dataService.user.resolveDir(PHOTOS_RELATIVE_DIR, userId);
  }

  /**
   * Persist a captured photo (+ best-effort thumbnail) for a user.
   *
   * @param {string} userId
   * @param {Buffer} buffer - raw image bytes
   * @param {{contentType?: string}} [_opts] - accepted for interface symmetry
   *   ONLY. Never trusted to determine the stored file's extension or the
   *   response Content-Type later served for it — both are fixed to the
   *   `.jpg` naming this store always writes (see module doc: no sharp, so no
   *   real re-encoding/transcoding is attempted here).
   * @returns {Promise<string>} photoRef, prefixed `ph_`
   */
  async save(userId, buffer, _opts = {}) {
    if (!userId) {
      throw new InfrastructureError('PhotoStore.save requires userId', { code: 'MISSING_USER_ID' });
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new InfrastructureError('PhotoStore.save requires a non-empty Buffer', { code: 'INVALID_BUFFER' });
    }

    const dir = this.#getDir(userId);
    ensureDir(dir);

    // Write-once artifact: `photoRef` is freshly minted every call, so this
    // should never collide with an existing file. `writeBinaryExclusive`
    // (flag 'wx') makes that an enforced invariant rather than an assumption
    // — a collision throws EEXIST instead of silently overwriting someone
    // else's photo, and callers (LogFoodFromImage's #persistPhoto) already
    // treat any save() throw as a non-fatal, logged failure.
    const photoRef = `ph_${shortId(16)}`;
    const originalPath = path.join(dir, `${photoRef}.jpg`);
    writeBinaryExclusive(originalPath, buffer);

    // Best-effort thumbnail via jimp. A failure here is logged and swallowed:
    // the original photo is already safely on disk, and that alone must be
    // enough for save() to have succeeded.
    try {
      const image = await Jimp.read(buffer);
      image.resize({ w: THUMBNAIL_WIDTH });
      const thumbBuffer = await image.getBuffer('image/jpeg');
      writeBinaryExclusive(path.join(dir, `${photoRef}.thumb.jpg`), thumbBuffer);
    } catch (e) {
      this.#logger.warn?.('PhotoStore.thumbnail.failed', { userId, photoRef, error: e.message });
    }

    return photoRef;
  }

  /**
   * Resolve the absolute path for a stored photo.
   *
   * Returns null (never throws) when the ref fails the allowlist, escapes
   * the user's photo directory, or the file doesn't exist — callers (the
   * serving route) turn null into a 404.
   *
   * @param {string} userId
   * @param {string} photoRef
   * @param {{size?: 'thumb'}} [opts]
   * @returns {string|null}
   */
  resolvePath(userId, photoRef, { size } = {}) {
    // 1) Strict allowlist check BEFORE the ref participates in any path join.
    if (!userId || !isValidPhotoRef(photoRef)) return null;

    const dir = this.#getDir(userId);
    const resolvedDir = path.resolve(dir);

    const wantThumb = size === 'thumb';
    const filename = wantThumb ? `${photoRef}.thumb.jpg` : `${photoRef}.jpg`;
    const candidate = path.resolve(dir, filename);

    // 2) Belt-and-braces containment check AFTER the join, independent of (1).
    if (candidate !== resolvedDir && !candidate.startsWith(resolvedDir + path.sep)) return null;

    if (fileExists(candidate)) return candidate;

    if (wantThumb) {
      // No thumbnail was produced (or jimp failed at save time) — fall back
      // to serving the original for size=thumb requests too.
      const originalCandidate = path.resolve(dir, `${photoRef}.jpg`);
      if (
        (originalCandidate === resolvedDir || originalCandidate.startsWith(resolvedDir + path.sep)) &&
        fileExists(originalCandidate)
      ) {
        return originalCandidate;
      }
    }

    return null;
  }
}

export default PhotoStore;
