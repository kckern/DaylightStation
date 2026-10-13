/** Semantic boundary for optional persistence of assembled feed sessions. */
export class FeedSessionPersistenceService {
  constructor({ store = null } = {}) { this.store = store; }
  get available() { return Boolean(this.store); }
  save(username, sessionId, snapshot) { return this.store?.save(username, sessionId, snapshot); }
  load(username, sessionId) { return this.store?.load(username, sessionId) ?? null; }
}

export default FeedSessionPersistenceService;
