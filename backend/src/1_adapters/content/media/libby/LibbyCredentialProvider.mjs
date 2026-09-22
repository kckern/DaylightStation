import { getFileStats, loadYamlFromPath } from '#system/utils/FileIO.mjs';

function jwtExpiry(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function unavailable(cause = null) {
  const error = new Error('Libby credential unavailable');
  error.code = 'LIBBY_CREDENTIAL_UNAVAILABLE';
  if (cause) error.cause = cause;
  return error;
}

/** Reloadable, fail-closed credential source for an externally rotated Libby JWT. */
export class LibbyCredentialProvider {
  #filePath;
  #stat;
  #load;
  #now;
  #logger;
  #generation = null;
  #snapshot = null;

  constructor({ filePath, stat = getFileStats, load = loadYamlFromPath, now = Date.now, logger = console } = {}) {
    if (!filePath) throw new Error('LibbyCredentialProvider requires filePath');
    this.#filePath = filePath;
    this.#stat = stat;
    this.#load = load;
    this.#now = now;
    this.#logger = logger;
  }

  #key(stats) {
    return `${stats?.ino ?? ''}:${stats?.size ?? ''}:${stats?.mtimeNs ?? stats?.mtimeMs ?? ''}`;
  }

  #valid(snapshot) {
    return snapshot && Number.isFinite(snapshot.expiresAt) && snapshot.expiresAt > this.#now();
  }

  getSnapshot() {
    try {
      const stats = this.#stat(this.#filePath);
      const generation = this.#key(stats);
      if (generation !== this.#generation) {
        const value = this.#load(this.#filePath);
        const token = typeof value?.token === 'string' ? value.token.trim() : '';
        if (!token) throw new Error('token field missing');
        const next = Object.freeze({ token, generation, expiresAt: jwtExpiry(token) });
        if (!this.#valid(next)) throw new Error('token expired');
        this.#snapshot = next;
        this.#generation = generation;
      }
    } catch (error) {
      this.#logger.warn?.('libby.auth.reload_failed', { reason: 'credential-file-unavailable' });
      if (!this.#valid(this.#snapshot)) throw unavailable(error);
    }
    if (!this.#valid(this.#snapshot)) throw unavailable();
    return this.#snapshot;
  }

  invalidate() { this.#generation = null; }
}

export default LibbyCredentialProvider;
