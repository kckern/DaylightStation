/**
 * VoiceMemoStore - persists a captured voice memo BEFORE it is transcribed
 * @module adapters/persistence/VoiceMemoStore
 *
 * Storage layout (per user, via `dataService.user.resolveDir`), a sibling of
 * PhotoStore's — same owner, same lifecycle, same privacy posture:
 *   users/{userId}/lifelog/nutrition/audio/{audioRef}.{ext}
 *
 * WHY THIS EXISTS. A voice memo used to live only in memory: the browser's
 * data URL was decoded into a Buffer, handed to Whisper, and dropped. On
 * 2026-09-04 three transcription attempts failed inside ~58s (ETIMEDOUT, then
 * two socket hang-ups) and the recording was simply gone — the person had said
 * their food out loud and had nothing to show for it. Bytes on disk are the
 * only thing that makes a transient upstream failure recoverable, so the memo
 * is written FIRST and transcribed second.
 *
 * Deliberately mirrors PhotoStore rather than inventing a second convention:
 * the same `dataService.user.resolveDir` seam, the same write-once
 * `writeBinaryExclusive`, the same allowlist-before-join /
 * containment-after-join path rules, and — like photos — NO delete method. A
 * failed transcription's audio is exactly the thing a retry needs.
 *
 * Unlike a photo the extension is NOT fixed: MediaRecorder's output format is
 * whatever the capturing browser chose (webm/opus on Chrome, mp4 on Safari),
 * and Whisper is told the format on the way back out, so the stored file has
 * to keep it. The extension is derived from an ALLOWLIST of known audio mime
 * types, never from the client's string directly.
 */

import path from 'node:path';
import { ensureDir, writeBinaryExclusive, fileExists, readBinaryFromPath } from '#system/utils/FileIO.mjs';
import { shortId } from '#system/utils/id.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/** The ONLY shape a valid audioRef may take. Never loosened. */
export const AUDIO_REF_PATTERN = /^va_[A-Za-z0-9]+$/;

export function isValidAudioRef(audioRef) {
  return typeof audioRef === 'string' && AUDIO_REF_PATTERN.test(audioRef);
}

const AUDIO_RELATIVE_DIR = 'lifelog/nutrition/audio';

/**
 * mime -> extension, allowlist only. A mime type we do not recognise stores as
 * `.bin`: the bytes are what matter for recovery, and an extension invented
 * from an unvalidated client string is a filename a caller could steer.
 */
const EXTENSION_BY_MIME = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/oga': 'oga',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
};

/** The stored extension for a mime type. Params (`;codecs=opus`) are dropped. */
export function extensionForMime(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSION_BY_MIME[base] || 'bin';
}

/** ext -> the mime Whisper should be told about, for a memo read back off disk. */
const MIME_BY_EXTENSION = {
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg',
  m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', bin: 'application/octet-stream',
};

export class VoiceMemoStore {
  #dataService;
  #logger;

  /**
   * @param {Object} options
   * @param {Object} options.dataService - DataService instance (uses .user.resolveDir)
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    if (!options.dataService) {
      throw new InfrastructureError('VoiceMemoStore requires dataService', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'dataService',
      });
    }
    this.#dataService = options.dataService;
    this.#logger = options.logger || console;
  }

  #getDir(userId) {
    return this.#dataService.user.resolveDir(AUDIO_RELATIVE_DIR, userId);
  }

  /**
   * Persist a captured voice memo.
   *
   * @param {string} userId
   * @param {Buffer} buffer - raw audio bytes
   * @param {{mimeType?: string}} [opts]
   * @returns {Promise<string>} audioRef, prefixed `va_`
   */
  async save(userId, buffer, opts = {}) {
    if (!userId) {
      throw new InfrastructureError('VoiceMemoStore.save requires userId', { code: 'MISSING_USER_ID' });
    }
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new InfrastructureError('VoiceMemoStore.save requires a non-empty Buffer', { code: 'INVALID_BUFFER' });
    }

    const dir = this.#getDir(userId);
    ensureDir(dir);

    // Write-once: the ref is freshly minted per call, so 'wx' turns "should
    // never collide" into an enforced invariant rather than an assumption.
    const audioRef = `va_${shortId(16)}`;
    writeBinaryExclusive(path.join(dir, `${audioRef}.${extensionForMime(opts.mimeType)}`), buffer);

    this.#logger.info?.('VoiceMemoStore.saved', { userId, audioRef, bytes: buffer.length });
    return audioRef;
  }

  /**
   * Read a stored memo back, for a retry that must not make the person record
   * again. Returns null when the ref resolves to nothing — the caller turns
   * that into "that recording is no longer available", never into a 500.
   *
   * @param {string} userId
   * @param {string} audioRef
   * @returns {Promise<{buffer: Buffer, mimeType: string}|null>}
   */
  async read(userId, audioRef) {
    const file = this.resolvePath(userId, audioRef);
    if (!file) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    // resolvePath already proved the file is there, so a read error here is
    // real I/O trouble and must NOT be masked as "no such recording".
    return { buffer: readBinaryFromPath(file), mimeType: MIME_BY_EXTENSION[ext] || 'application/octet-stream' };
  }

  /**
   * Resolve the absolute path of a stored memo, whatever extension it kept.
   *
   * Returns null (never throws) when the ref fails the allowlist, escapes the
   * user's audio directory, or no file exists — callers turn null into a 404.
   *
   * @param {string} userId
   * @param {string} audioRef
   * @returns {string|null}
   */
  resolvePath(userId, audioRef) {
    // 1) Strict allowlist BEFORE the ref participates in any path join.
    if (!userId || !isValidAudioRef(audioRef)) return null;

    const dir = this.#getDir(userId);
    // The extension is not part of the ref, so every known one is tried. The
    // candidate list is closed — it never includes a client-supplied string.
    for (const ext of [...new Set(Object.values(EXTENSION_BY_MIME)), 'bin']) {
      const candidate = path.join(dir, `${audioRef}.${ext}`);
      // 2) Containment AFTER the join — belt and braces, so a loosened regex
      //    alone cannot reopen traversal.
      const resolved = path.resolve(candidate);
      if (!resolved.startsWith(path.resolve(dir) + path.sep)) continue;
      if (fileExists(resolved)) return resolved;
    }
    return null;
  }
}

export default VoiceMemoStore;
