import { randomUUID } from 'node:crypto';

/**
 * Signed-in browser sessions, so they can be listed and revoked.
 *
 * The JWT is configured for ten years and nothing shortens it, so signing out
 * on one device — or throwing a lost phone out of the household — cannot work
 * by letting a token lapse. It has to be a record someone can delete. The token
 * carries a `sid`; this is what that id points at, and `tokenResolver` refuses
 * a token whose session is gone.
 *
 * Household-scoped, one file. Sessions are a handful of rows for a handful of
 * adults, not a table — rewriting the file per mutation is cheaper here than
 * any index would be, and it survives a restart, which an in-memory map would
 * not. A restart that silently signed everyone out would make "revoke" and
 * "we redeployed" indistinguishable.
 *
 * NO TOKEN IS STORED. A row holds the session id and who it belongs to; the
 * bearer material never lands on disk, so a readable backup of this file grants
 * nobody anything.
 */
const PATH = 'auth/sessions';

export class DataServiceAuthSessionStore {
  #dataService; #clock; #idFn; #logger;

  constructor({ dataService, clock = () => new Date(), idFn = randomUUID, logger = console }) {
    if (!dataService) throw new Error('DataServiceAuthSessionStore requires dataService');
    this.#dataService = dataService; this.#clock = clock; this.#idFn = idFn; this.#logger = logger;
  }

  #all() {
    const raw = this.#dataService.system.read(PATH);
    return Array.isArray(raw?.sessions) ? raw.sessions : [];
  }

  #save(sessions) {
    this.#dataService.system.write(PATH, { sessions });
  }

  /**
   * @param {{username: string, userAgent?: string|null, ip?: string|null}} input
   * @returns {{id: string}} the id to put in the token's `sid`
   */
  create({ username, userAgent = null, ip = null }) {
    const id = this.#idFn();
    const at = this.#clock().toISOString();
    const sessions = this.#all();
    sessions.push({
      id, username, createdAt: at, lastSeenAt: at,
      // Truncated: a user agent is for recognising WHICH device this is in a
      // revoke list, and the full string is a paragraph.
      userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 180) : null,
      ip: typeof ip === 'string' ? ip.slice(0, 60) : null,
    });
    this.#save(sessions);
    this.#logger.info?.('auth.session.created', { id, username });
    return { id };
  }

  /** @returns {boolean} whether this session is still live. */
  isActive(id) {
    if (!id) return false;
    return this.#all().some(row => row.id === id);
  }

  /**
   * Stamp last-seen. BEST EFFORT and deliberately throttled: this runs on every
   * authenticated request, and rewriting the file each time would turn a read
   * path into a write path. A minute's resolution is all a revoke list needs.
   */
  touch(id) {
    if (!id) return;
    const sessions = this.#all();
    const row = sessions.find(entry => entry.id === id);
    if (!row) return;
    const now = this.#clock();
    if (row.lastSeenAt && now - new Date(row.lastSeenAt) < 60_000) return;
    row.lastSeenAt = now.toISOString();
    try { this.#save(sessions); } catch (error) {
      this.#logger.warn?.('auth.session.touch_failed', { id, error: error.message });
    }
  }

  /** Newest first — the one you just signed in on is the one you are looking for. */
  list() {
    return this.#all()
      .map(({ id, username, createdAt, lastSeenAt, userAgent, ip }) => ({ id, username, createdAt, lastSeenAt, userAgent, ip }))
      .sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
  }

  /** @returns {boolean} whether a row was actually removed. */
  revoke(id) {
    const sessions = this.#all();
    const next = sessions.filter(row => row.id !== id);
    if (next.length === sessions.length) return false;
    this.#save(next);
    this.#logger.info?.('auth.session.revoked', { id });
    return true;
  }

  /** Every session but the one asking — "sign out everywhere else". */
  revokeAllExcept(keepId) {
    const sessions = this.#all();
    const next = sessions.filter(row => row.id === keepId);
    this.#save(next);
    const removed = sessions.length - next.length;
    this.#logger.info?.('auth.session.revoked_all', { removed, keptId: keepId ?? null });
    return { removed };
  }
}

export default DataServiceAuthSessionStore;
