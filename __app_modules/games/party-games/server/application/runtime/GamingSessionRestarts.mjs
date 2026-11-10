/** Successor metadata is separate from the immutable source session journal. */
export class GamingSessionRestarts {
  constructor({ repository = null } = {}) {
    this.repository = repository;
    this.memory = new Map();
    this.pending = new Map();
  }
  async replacementFor(sessionId) {
    return sessionId.startsWith('diagnostic:') || !this.repository
      ? this.memory.get(sessionId) || null : this.repository.get(sessionId);
  }
  async restart(sessionId, application, viewer) {
    // Serialize retries and simultaneous host tabs against this authority.
    if (this.pending.has(sessionId)) return this.pending.get(sessionId);
    const work = (async () => {
      const source = await application.resumeSession(sessionId, viewer);
      const existing = await this.replacementFor(sessionId);
      if (existing) return application.resumeSession(existing, viewer);
      if (source.header.ruleset.id !== 'jeopardy') throw Object.assign(new Error('Only Jeopardy sessions support restart'), { code: 'invalid_session_setup' });
      const definitionId = source.diagnostic?.definition_id || source.header.artifacts?.rules_definition?.id;
      if (!definitionId) throw Object.assign(new Error('Session definition identity is unavailable'), { code: 'invalid_session_setup' });
      const seats = source.header.seats || [];
      const result = await application.createSession({
        definitionId, surfaceId: source.header.launch?.surface_id || source.header.surface_id || 'party-games',
        seats, participants: source.header.participants || [], setup: { teams: seats, seats }, viewer,
      });
      const replacement = result.header.session_id;
      if (sessionId.startsWith('diagnostic:') || !this.repository) this.memory.set(sessionId, replacement);
      else await this.repository.put(sessionId, replacement);
      return result;
    })();
    this.pending.set(sessionId, work);
    try { return await work; } finally { this.pending.delete(sessionId); }
  }
}
