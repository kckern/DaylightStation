import { goodFaithQuestion, goodFaithFromAnswer, normaliseGoodFaithState } from '../../portable/practice/sittingGoodFaith.mjs';

/**
 * JudgeLessonSitting — the session-level good-faith judgement (owner,
 * 2026-11-12). One scoped decision-gateway `score` call per finished lesson
 * sitting ({ app: 'piano', feature: 'lesson-good-faith' }), asked when the
 * kiosk's play/log first carries the sitting's state (at the watch threshold),
 * so the child never waits on it at the end of the lesson.
 *
 * The state is the minimal MIDI log only (sittingGoodFaith: practice-like
 * notes, notes per minute, lesson facts, presence check-ins) — re-normalised
 * here, so nothing else a kiosk sends ever reaches the model. A timeout (8 s),
 * error or missing gateway is a final `fallback` for that sitting: the
 * progress store's lenient deterministic rule decides, with the benefit of the
 * doubt. Answers live in memory (bounded, 6 h); the store copies a score onto
 * the sitting it belongs to, so a restart loses nothing that was decided.
 */
export class JudgeLessonSitting {
  #gateway; #enabled; #timeoutMs; #scheduler; #logger; #now; #ttlMs; #max;
  #entries = new Map();

  constructor({ decisionGateway, enabled = () => false, timeoutMs = 8000, scheduler = null, logger = console, maxEntries = 500, ttlMs = 6 * 3600 * 1000, now = () => Date.now() }) {
    this.#gateway = decisionGateway;
    this.#enabled = enabled;
    this.#timeoutMs = timeoutMs;
    this.#scheduler = scheduler;
    this.#logger = logger;
    this.#max = maxEntries;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  #key(userId, sittingId) { return `${userId}|${sittingId}`; }

  #entry(key) {
    const e = this.#entries.get(key);
    if (e && this.#now() - e.at > this.#ttlMs) { this.#entries.delete(key); return null; }
    return e ?? null;
  }

  /** The finished judgement for a sitting, or null (none, still pending, or switched off). */
  peek({ userId, sittingId }) {
    return this.#entry(this.#key(userId, sittingId))?.result ?? null;
  }

  /** Ask (or join) the one judgement for this sitting. Never rejects. */
  judge({ userId, sittingId, state, preschool = false }) {
    if (!this.#enabled()) return Promise.resolve({ score: null, source: 'disabled' });
    const key = this.#key(userId, sittingId);
    const existing = this.#entry(key);
    if (existing) return existing.promise;
    const clean = normaliseGoodFaithState(state);
    if (!clean) {
      this.#logger.warn?.('piano.lesson-good-faith.invalid-state', { userId });
      return Promise.resolve({ score: null, source: 'invalid' });
    }
    clean.lesson.preschool = !!preschool;
    const entry = { at: this.#now(), result: null, promise: null };
    entry.promise = this.#ask(userId, clean, !!preschool).then((r) => { entry.result = r; return r; });
    this.#entries.set(key, entry);
    while (this.#entries.size > this.#max) this.#entries.delete(this.#entries.keys().next().value);
    return entry.promise;
  }

  async #ask(userId, state, preschool) {
    const started = this.#now();
    const facts = { userId, notes: state.lesson.notesPlayed, checkIns: state.presence.checkIns, preschool };
    const fallback = (reason, extra = {}) => {
      this.#logger.warn?.('piano.lesson-good-faith.fallback', { ...facts, reason, ms: this.#now() - started, ...extra });
      return { score: null, source: 'fallback', reason };
    };
    if (!this.#gateway || typeof this.#gateway.evaluate !== 'function') return fallback('no-gateway');
    try {
      const call = this.#gateway.evaluate(state, { goodFaith: goodFaithQuestion(preschool) }, { timeout: this.#timeoutMs });
      const res = this.#scheduler?.withDeadline
        ? await this.#scheduler.withDeadline(call, { milliseconds: this.#timeoutMs, description: 'lesson-good-faith' })
        : await call;
      const score = goodFaithFromAnswer(res?.answers?.goodFaith);
      if (score == null) return fallback('no-score');
      const result = { score, source: 'model', model: res?.model ?? null };
      this.#logger.info?.('piano.lesson-good-faith.judged', {
        ...facts, score, source: 'model', model: result.model, ms: this.#now() - started,
        levelProbabilities: res?.answers?.goodFaith?.probabilities ?? null, inputTokens: res?.usage?.inputTokens ?? null,
      });
      return result;
    } catch (err) {
      return fallback(/timed out/.test(err?.message || '') ? 'timeout' : 'error', { error: err?.message });
    }
  }
}

export default JudgeLessonSitting;
