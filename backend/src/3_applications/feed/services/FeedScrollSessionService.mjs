/** Owns scroll-session identity, expiry, restoration, snapshots, and enrichment. */
export class FeedScrollSessionService {
  constructor({ assembly, state = null, persistence = null, createId, clock = () => Date.now(), ttlMs = 86_400_000 } = {}) {
    this.assembly = assembly;
    this.state = state;
    this.persistence = persistence;
    this.createId = createId;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
  }

  sourcePreferences(username) { return this.state?.getSourcePreferences(username) || {}; }
  enrich(username, items) { return this.state ? this.state.enrich(username, items || [], 'scroll') : items; }
  persist(username, sessionId) {
    this.persistence?.save(username, sessionId, this.assembly.snapshotSession(username, sessionId));
  }
  restore(username, sessionId) {
    if (!this.persistence?.available) return null;
    const persisted = this.persistence.load(username, sessionId);
    if (!persisted || !this.assembly.restoreSession(username, sessionId, persisted.snapshot)) return null;
    const session = { username, createdAt: new Date(persisted.createdAt).getTime(), lastAccess: this.clock() };
    this.sessions.set(sessionId, session);
    return session;
  }

  async create(username, options = {}) {
    const sessionId = this.createId();
    const result = await this.assembly.getNextBatch(username, {
      ...options, sourcePreferences: this.sourcePreferences(username), sessionId,
    });
    const now = this.clock();
    this.sessions.set(sessionId, { username, createdAt: now, lastAccess: now });
    this.persist(username, sessionId);
    const items = this.enrich(username, result.items);
    return { ...result, items, sessionId, nextCursor: items?.at(-1)?.id || null };
  }

  async continue(username, sessionId, { resume = false, ...options } = {}) {
    let session = this.sessions.get(sessionId) ?? this.restore(username, sessionId);
    if (!session || session.username !== username || this.clock() - session.lastAccess > this.ttlMs) {
      this.sessions.delete(sessionId);
      return { kind: 'expired' };
    }
    session.lastAccess = this.clock();
    if (resume) {
      const items = this.enrich(username, this.assembly.getSessionItems(username, sessionId));
      const hasMore = this.assembly.sessionHasMore(username, sessionId);
      return { kind: 'found', result: {
        ...this.assembly.getSessionMetadata(username, sessionId), items, hasMore,
        caughtUp: !hasMore, sessionId, nextCursor: items.at(-1)?.id || null, resumed: true,
      } };
    }
    const result = await this.assembly.getNextBatch(username, {
      ...options, sourcePreferences: this.sourcePreferences(username), sessionId,
    });
    const items = this.enrich(username, result.items);
    this.persist(username, sessionId);
    return { kind: 'found', result: { ...result, items, sessionId, nextCursor: items?.at(-1)?.id || null } };
  }

  async getBatch(username, { sessionId = null, ...options } = {}) {
    if (sessionId && !this.assembly.hasSession(username, sessionId)) this.restore(username, sessionId);
    let result = await this.assembly.getNextBatch(username, {
      ...options, sourcePreferences: this.sourcePreferences(username), sessionId,
    });
    if (this.state) result = { ...result, items: this.enrich(username, result.items || []) };
    if (sessionId) this.persist(username, sessionId);
    return result;
  }
}

export default FeedScrollSessionService;
