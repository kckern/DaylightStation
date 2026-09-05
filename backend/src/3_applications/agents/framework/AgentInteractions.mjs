import { sha256Text } from '#system/utils/sha256.mjs';

/** Shared questions; a channel is only a projection of this record. */
export class AgentInteractions {
  #active = new Map();
  constructor({ store, clock, onAnswer }) { Object.assign(this, { store, clock, onAnswer }); }
  ask(userId, question) {
    const id = sha256Text(JSON.stringify([question.issueKey, question.entryVersions])).slice(0, 24);
    return this.store.update(userId, state => {
      if (state.questions[id]) return state.questions[id];
      const saved = { ...question, id, userId, version: 1, status: 'open', createdAt: new Date(this.clock.now()).toISOString() };
      state.questions[id] = saved;
      return saved;
    });
  }
  list(userId) { return Object.values(this.store.load(userId).questions); }
  async answer({ userId, id, expectedVersion, operationId, choiceId, text, dismiss = false }) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId || '')) throw Object.assign(new Error('Operation ID required'), { status: 400 });
    if (text != null && (typeof text !== 'string' || text.length > 4000)) throw Object.assign(new Error('Invalid answer'), { status: 400 });
    if (typeof dismiss !== 'boolean' || (choiceId != null && typeof choiceId !== 'string') || (choiceId && text?.trim())) throw Object.assign(new Error('Provide one answer'), { status: 400 });
    const fingerprint = sha256Text(JSON.stringify({ choiceId: choiceId || null, text: text?.trim() || null, dismiss }));
    const question = this.store.update(userId, state => {
      const q = state.questions[id];
      if (!q) throw Object.assign(new Error('Question not found'), { status: 404 });
      if (q.answer?.operationId === operationId) {
        if (q.answer.fingerprint !== fingerprint) throw Object.assign(new Error('Operation ID already used for another answer'), { status: 409 });
        return q;
      }
      if (q.version !== expectedVersion || q.status !== 'open') throw Object.assign(new Error('Question already changed'), { status: 409 });
      const choice = choiceId ? q.choices?.find(item => item.id === choiceId) : null;
      if (!dismiss && !choice && !text?.trim()) throw Object.assign(new Error('Choose an answer or enter a response'), { status: 400 });
      q.answer = { operationId, fingerprint, choiceId: choiceId || null, text: text?.trim() || null, dismiss };
      q.status = dismiss ? 'dismissed' : 'answering';
      q.version++;
      return q;
    });
    if (question.status !== 'answering') return question;
    return this.#resolve(userId, question);
  }
  async #resolve(userId, question) {
    const key = userId + ':' + question.id;
    if (this.#active.has(key)) return this.#active.get(key);
    const promise = (async () => {
      this.store.update(userId, state => { const q = state.questions[question.id]; q.answerAttempts = (q.answerAttempts || 0) + 1; });
      try {
        const outcome = await this.onAnswer(userId, question);
        return this.store.update(userId, state => {
          const q = state.questions[question.id];
          q.status = outcome?.status || 'resolved'; q.outcome = outcome || {};
          q.resolvedAt = new Date(this.clock.now()).toISOString(); q.version++;
          return q;
        });
      } catch (error) {
        if (error.status === 409 || error.status === 404) return this.store.update(userId, state => {
          const q = state.questions[question.id]; q.status = 'stale'; q.version++; q.outcome = { message: error.message }; return q;
        });
        const exhausted = this.store.update(userId, state => {
          const q = state.questions[question.id];
          q.retryAt = this.clock.now() + 30000 * Math.pow(2, q.answerAttempts - 1);
          if (q.answerAttempts < 3) return false;
          q.status = 'stale'; q.version++;
          q.outcome = { message: 'The answer could not be processed after three attempts. Please review the food manually.' };
          return q;
        });
        if (exhausted) return exhausted;
        // Leave answering durable so a restart can finish the exact operation.
        throw error;
      }
    })();
    this.#active.set(key, promise);
    try { return await promise; } finally { this.#active.delete(key); }
  }
  async recover(userId) {
    for (const q of this.list(userId).filter(q => q.status === 'answering' && (!q.retryAt || q.retryAt <= this.clock.now()))) await this.#resolve(userId, q);
  }
}
