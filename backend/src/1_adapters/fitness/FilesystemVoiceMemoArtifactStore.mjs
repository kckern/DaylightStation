/**
 * FilesystemVoiceMemoArtifactStore — durable home for a fitness voice memo
 * BEFORE it has been transcribed.
 *
 * Storage layout, household-scoped so it sits beside the sessions the memos
 * belong to (`household[-{id}]/fitness/log/...`):
 *
 *   household[-{id}]/fitness/voice-memos/{ref}.{ext}    raw audio, purged on
 *                                                       success or retention
 *   household[-{id}]/fitness/voice-memos/{ref}.json     lifecycle record
 *
 * PRIVACY POSTURE. Raw voice is personal data. It lives only here — never in
 * the repo, the log store, an analytics event, or a debug directory — is
 * written 0600, is bounded in size and in time, and is purged as soon as the
 * transcript exists. The lifecycle record deliberately carries nothing but
 * what recovery needs: an opaque ref, session correlation, timestamps, media
 * type/size, a checksum, the attempt counter, and an allowlisted failure
 * classification. No transcript text, no credentials, no provider bodies.
 *
 * Mirrors nutrition's VoiceMemoStore conventions rather than inventing a
 * second one: opaque prefixed ref, strict allowlist BEFORE any path join,
 * containment check AFTER it, extension from a mime allowlist and never from
 * the client's string. It differs in one way that the fitness flow requires —
 * this store DOES delete, because a memo whose transcript has landed must not
 * leave a voice recording behind.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureDir, fileExists, listFiles, readTextFromPath, readBinaryFromPath,
  writeBinaryExclusive, writeFileAtomic, deleteFile,
} from '#system/utils/FileIO.mjs';
import { listHouseholdDirs, parseHouseholdId } from '#system/utils/householdDirs.mjs';
import { shortId } from '#system/utils/id.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';
import { ARTIFACT_STATES, MAX_ARTIFACT_BYTES } from '#domains/fitness/services/voiceMemoArtifactLifecycle.mjs';

/** The ONLY shape a valid artifact ref may take. Never loosened. */
export const ARTIFACT_REF_PATTERN = /^vm_[A-Za-z0-9]{16}$/;

export function isValidArtifactRef(ref) {
  return typeof ref === 'string' && ARTIFACT_REF_PATTERN.test(ref);
}

const ARTIFACT_RELATIVE_DIR = 'fitness/voice-memos';

/** mime -> extension, allowlist only. An unknown mime stores as `.bin`. */
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

const MIME_BY_EXTENSION = {
  webm: 'audio/webm', ogg: 'audio/ogg', oga: 'audio/ogg', mp3: 'audio/mpeg',
  m4a: 'audio/mp4', wav: 'audio/wav', flac: 'audio/flac', bin: 'application/octet-stream',
};

const AUDIO_EXTENSIONS = [...new Set(Object.values(EXTENSION_BY_MIME)), 'bin'];

/** The stored extension for a mime type. Params (`;codecs=opus`) are dropped. */
export function extensionForMime(mimeType) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  return EXTENSION_BY_MIME[base] || 'bin';
}

export class FilesystemVoiceMemoArtifactStore {
  #configService;
  #logger;
  #clock;
  #maxBytes;

  /**
   * @param {Object} options
   * @param {Object} options.configService - provides getHouseholdPath/getDataDir
   * @param {Object} [options.logger]
   * @param {Function} [options.clock] - () => epoch ms
   * @param {number} [options.maxBytes]
   */
  constructor(options = {}) {
    if (!options.configService) {
      throw new InfrastructureError('FilesystemVoiceMemoArtifactStore requires configService', {
        code: 'MISSING_DEPENDENCY', dependency: 'configService',
      });
    }
    this.#configService = options.configService;
    this.#logger = options.logger || console;
    this.#clock = options.clock || (() => Date.now());
    this.#maxBytes = options.maxBytes ?? MAX_ARTIFACT_BYTES;
  }

  get maxBytes() { return this.#maxBytes; }

  #dir(householdId) {
    return this.#configService.getHouseholdPath(ARTIFACT_RELATIVE_DIR, householdId ?? null);
  }

  /**
   * Every household id that has (or could have) an artifact directory. The
   * retry worker sweeps all of them: a memo recorded under a second household
   * is no less recoverable than one under the default.
   * @returns {string[]}
   */
  householdIds() {
    const ids = new Set();
    try {
      ids.add(this.#configService.getDefaultHouseholdId?.() ?? 'default');
    } catch { /* a config without households still gets the scan below */ }
    try {
      for (const folder of listHouseholdDirs(this.#configService.getDataDir())) {
        ids.add(parseHouseholdId(folder));
      }
    } catch { /* an unreadable data dir is reported by the sweep, not here */ }
    return [...ids];
  }

  /**
   * Persist a capture and open its lifecycle record.
   *
   * Write order matters: the audio lands first with `wx`, then the record. A
   * crash between the two leaves an orphan blob (harmless, swept by
   * `listOrphanAudio`); the reverse would leave a record promising audio that
   * is not there, which is the failure this whole store exists to prevent.
   *
   * @param {Object} input
   * @param {Buffer} input.buffer
   * @param {string} [input.mimeType]
   * @param {string} [input.householdId]
   * @param {string} [input.sessionId]
   * @param {number} [input.startedAt]
   * @param {number} [input.endedAt]
   * @param {Object} [input.context] - session context, stored for the retry's prompt
   * @returns {Promise<Object>} the lifecycle record
   */
  async create({ buffer, mimeType = null, householdId = null, sessionId = null,
    startedAt = null, endedAt = null, context = {} } = {}) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new InfrastructureError('Voice memo artifact requires a non-empty Buffer', {
        code: 'INVALID_BUFFER',
      });
    }
    if (buffer.length > this.#maxBytes) {
      throw new InfrastructureError('Voice memo artifact exceeds the maximum size', {
        code: 'ARTIFACT_TOO_LARGE', details: { bytes: buffer.length, maxBytes: this.#maxBytes },
      });
    }

    const dir = this.#dir(householdId);
    ensureDir(dir);

    const ref = `vm_${shortId(16)}`;
    const extension = extensionForMime(mimeType);
    const capturedAt = this.#clock();

    // 0600: the data volume is shared with other apps and a sync client. The
    // bytes are somebody's voice; nothing but this process needs to read them.
    writeBinaryExclusive(path.join(dir, `${ref}.${extension}`), buffer, { mode: 0o600 });

    const record = {
      ref,
      state: ARTIFACT_STATES.PENDING,
      householdId: householdId ?? null,
      sessionId: sessionId ?? null,
      mimeType: mimeType ?? null,
      extension,
      bytes: buffer.length,
      checksum: `sha256:${createHash('sha256').update(buffer).digest('hex')}`,
      capturedAt,
      updatedAt: capturedAt,
      startedAt: startedAt ?? null,
      endedAt: endedAt ?? null,
      attempts: 0,
      attemptStartedAt: null,
      nextAttemptAt: null,
      audioPurgedAt: null,
      transcribedAt: null,
      lastFailure: null,
      context: sanitizeContext(context),
    };
    this.#writeRecord(householdId, record);
    return record;
  }

  /** @returns {Object|null} the record, or null when the ref is bogus or gone. */
  get(householdId, ref) {
    const file = this.#recordPath(householdId, ref);
    if (!file || !fileExists(file)) return null;
    try {
      const parsed = JSON.parse(readTextFromPath(file));
      // A record whose `ref` disagrees with its filename is corrupt, not a
      // record: refusing it beats letting a mangled file drive a purge.
      return parsed?.ref === ref ? parsed : null;
    } catch (error) {
      this.#logger.error?.('fitness.voice_memo.artifact.record_unreadable', {
        ref, error: error?.message,
      });
      return null;
    }
  }

  /**
   * Merge a patch into a record. Returns the merged record, or null when the
   * record has since been deleted (a losing race with the retention sweep is
   * not an error — the caller simply has nothing to update).
   */
  update(householdId, ref, patch) {
    const current = this.get(householdId, ref);
    if (!current) return null;
    const next = { ...current, ...patch, ref, updatedAt: patch?.updatedAt ?? this.#clock() };
    this.#writeRecord(householdId, next);
    return next;
  }

  /**
   * Claim a record for a transcription attempt.
   *
   * The write is the lease: a record that is already `processing` is refused
   * so two workers — or a worker and an inline request — cannot transcribe the
   * same audio twice.
   * @returns {Object|null} the leased record, or null if it could not be claimed
   */
  claim(householdId, ref, now = this.#clock()) {
    const current = this.get(householdId, ref);
    if (!current) return null;
    if (current.state === ARTIFACT_STATES.PROCESSING) return null;
    return this.update(householdId, ref, {
      state: ARTIFACT_STATES.PROCESSING, attemptStartedAt: now, updatedAt: now,
    });
  }

  /** @returns {{buffer: Buffer, mimeType: string}|null} */
  readAudio(householdId, ref) {
    const file = this.resolveAudioPath(householdId, ref);
    if (!file) return null;
    const ext = path.extname(file).slice(1).toLowerCase();
    return {
      buffer: readBinaryFromPath(file),
      mimeType: MIME_BY_EXTENSION[ext] || 'application/octet-stream',
    };
  }

  /**
   * Remove the raw audio, keeping the lifecycle record. Idempotent: a second
   * call on an already-purged artifact is a no-op, which is what makes the
   * retention sweep safe to run as often as it likes.
   * @returns {boolean} whether a file was actually removed
   */
  purgeAudio(householdId, ref, now = this.#clock()) {
    const file = this.resolveAudioPath(householdId, ref);
    const removed = file ? deleteFile(file) : false;
    this.update(householdId, ref, { audioPurgedAt: now });
    return removed;
  }

  /** Remove the record AND any audio still beside it. Terminal, for retention only. */
  deleteRecord(householdId, ref) {
    const audio = this.resolveAudioPath(householdId, ref);
    if (audio) deleteFile(audio);
    const file = this.#recordPath(householdId, ref);
    return file ? deleteFile(file) : false;
  }

  /**
   * List lifecycle records for one household, newest capture first.
   * @param {string|null} householdId
   * @param {{states?: string[], limit?: number, sessionId?: string}} [filter]
   */
  list(householdId, filter = {}) {
    const dir = this.#dir(householdId);
    const states = filter.states ? new Set(filter.states) : null;
    const records = [];
    for (const name of listFiles(dir)) {
      if (!name.endsWith('.json')) continue;
      const record = this.get(householdId, name.slice(0, -'.json'.length));
      if (!record) continue;
      if (states && !states.has(record.state)) continue;
      if (filter.sessionId && String(record.sessionId) !== String(filter.sessionId)) continue;
      records.push(record);
    }
    records.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));
    return filter.limit ? records.slice(0, filter.limit) : records;
  }

  /**
   * Audio files with no lifecycle record — the orphan a crash between the two
   * writes leaves behind. Reported by ref so the sweep can remove them.
   */
  listOrphanAudio(householdId) {
    const dir = this.#dir(householdId);
    const orphans = [];
    for (const name of listFiles(dir)) {
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) continue;
      const ref = name.slice(0, -(ext.length + 1));
      if (!isValidArtifactRef(ref)) continue;
      if (!this.get(householdId, ref)) orphans.push({ ref, path: path.join(dir, name) });
    }
    return orphans;
  }

  /**
   * Absolute path of the stored audio, whatever extension it kept, or null.
   * Never throws: a bad ref, an escaping ref, and a missing file are all
   * "there is no recording here", which callers turn into a 404.
   */
  resolveAudioPath(householdId, ref) {
    if (!isValidArtifactRef(ref)) return null;
    const dir = this.#dir(householdId);
    for (const ext of AUDIO_EXTENSIONS) {
      const resolved = path.resolve(path.join(dir, `${ref}.${ext}`));
      if (!resolved.startsWith(path.resolve(dir) + path.sep)) continue;
      if (fileExists(resolved)) return resolved;
    }
    return null;
  }

  #recordPath(householdId, ref) {
    if (!isValidArtifactRef(ref)) return null;
    const dir = this.#dir(householdId);
    const resolved = path.resolve(path.join(dir, `${ref}.json`));
    return resolved.startsWith(path.resolve(dir) + path.sep) ? resolved : null;
  }

  #writeRecord(householdId, record) {
    const file = this.#recordPath(householdId, record.ref);
    if (!file) {
      throw new InfrastructureError('Refusing to write a voice memo record for an invalid ref', {
        code: 'INVALID_ARTIFACT_REF',
      });
    }
    // Atomic: a half-written record read by the worker mid-sweep would be
    // indistinguishable from a corrupt one and would strand the artifact.
    writeFileAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
  }
}

/**
 * Keep only the context fields the retry's Whisper prompt actually uses.
 * Everything else the browser sends is dropped rather than persisted next to
 * somebody's voice recording for a week.
 */
function sanitizeContext(context) {
  if (!context || typeof context !== 'object') return {};
  const strings = (value) => (Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry).slice(0, 20)
    : undefined);
  const text = (value) => (typeof value === 'string' && value ? value.slice(0, 200) : undefined);
  return JSON.parse(JSON.stringify({
    currentShow: text(context.currentShow),
    currentEpisode: text(context.currentEpisode),
    recentShows: strings(context.recentShows),
    activeUsers: strings(context.activeUsers),
    householdMembers: strings(context.householdMembers),
    householdId: text(context.householdId),
  }));
}

export default FilesystemVoiceMemoArtifactStore;
