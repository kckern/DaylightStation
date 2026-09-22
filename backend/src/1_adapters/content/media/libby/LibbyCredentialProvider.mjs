import { getFileStats, loadYamlFromPath, readTextFromPath, writeFileAtomic } from '#system/utils/FileIO.mjs';

function jwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function jwtExpiry(token) {
  const payload = jwtPayload(token);
  return Number.isFinite(payload?.exp) ? payload.exp * 1000 : null;
}

function jwtChipId(token) {
  const id = jwtPayload(token)?.chip?.id;
  return typeof id === 'string' && id ? id : null;
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
  #readText;
  #writeAtomic;
  #generation = null;
  #snapshot = null;

  constructor({ filePath, stat = getFileStats, load = loadYamlFromPath, now = Date.now, logger = console,
    readText = readTextFromPath, writeAtomic = writeFileAtomic } = {}) {
    if (!filePath) throw new Error('LibbyCredentialProvider requires filePath');
    this.#filePath = filePath;
    this.#stat = stat;
    this.#load = load;
    this.#now = now;
    this.#logger = logger;
    this.#readText = readText;
    this.#writeAtomic = writeAtomic;
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
        const next = Object.freeze({ token, generation, expiresAt: jwtExpiry(token), chipId: jwtChipId(token) });
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

  /**
   * Replace the stored token. Rewrites only the `token:` line so operator
   * comments and any sibling keys survive a machine-driven rotation.
   */
  async persist(token) {
    const expiresAt = jwtExpiry(token);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.#now()) {
      throw new Error('Libby credential write refused: token is malformed or already expired');
    }
    const current = this.#readText(this.#filePath);
    const line = `token: ${token}`;
    const next = /^token:.*$/m.test(current)
      ? current.replace(/^token:.*$/m, line)
      : `${current.replace(/\n*$/, '\n')}${line}\n`;
    this.#writeAtomic(this.#filePath, next);
    this.invalidate();
  }

  invalidate() { this.#generation = null; }
}

export default LibbyCredentialProvider;
