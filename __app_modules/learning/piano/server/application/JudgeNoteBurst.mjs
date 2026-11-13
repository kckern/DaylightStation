import { contentHash } from '../../portable/practice/lessonExpectation.mjs';

/** The legitimacy question (owner, 2026-11-12). The model sees ONLY a minimal MIDI log. */
export const LEGIT_QUESTION = 'Is this a genuine attempt to play (practice/play-along) rather than random mashing, single-key spam, or idle tapping? `notes` lists each key press (pitch, onset ms, duration ms, velocity); `stats` summarises them.';
/** Preschool courses: any deliberate key-pressing is fine; the question is whether a child is there at all. */
export const PRESCHOOL_LEGIT_QUESTION = 'Is this a small child genuinely trying to play along, rather than no one playing / a machine? `notes` lists each key press (pitch, onset ms, duration ms, velocity); `stats` summarises them.';

export const LEGIT_PASS_PROBABILITY = 0.7;
const KINDS = new Set(['check-in', 'end-of-lesson']);

/**
 * JudgeNoteBurst — asks the scoped decision gateway one yesNo question about a
 * burst of notes, off the critical path: the kiosk never waits on it, a
 * timeout/error/missing gateway is a 'fallback' (the deterministic verdict
 * stands), answers are cached per burst, and each (user, sitting, kind, index)
 * gets at most one model call.
 */
export class JudgeNoteBurst {
  #gateway; #cache; #enabled; #timeoutMs; #logger; #scheduler;
  #asked = new Set();

  constructor({ decisionGateway, cache, enabled = () => false, timeoutMs = 8000, scheduler = null, logger = console }) {
    this.#scheduler = scheduler;
    this.#gateway = decisionGateway;
    this.#cache = cache;
    this.#enabled = enabled;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  #store(kind, userId, sittingId, value) {
    if (kind === 'end-of-lesson' && value.probability != null) {
      this.#cache.set({ userId, sittingId, kind }, { probability: value.probability, source: value.source });
    }
  }

  async execute({ userId, sittingId, kind, index = 0, burst, preschool = false }) {
    const started = Date.now();
    const notes = burst?.notes || [];
    const stats = burst?.stats || {};
    const k = KINDS.has(kind) ? kind : 'check-in';
    const done = (result, extra = {}) => {
      this.#logger.info?.('piano.lesson-legit.judged', {
        userId, kind: k, index, probability: result.probability, legit: result.legit, source: result.source,
        notes: notes.length, ms: Date.now() - started, preschool: !!preschool, ...extra,
      });
      return result;
    };
    if (!this.#enabled()) return done({ legit: null, probability: null, source: 'disabled' });

    const burstKey = `burst:${k}:${preschool ? 'pre' : 'std'}:${contentHash(JSON.stringify(notes))}`;
    const cached = this.#cache.get(burstKey);
    if (cached) {
      const r = { legit: cached.probability >= LEGIT_PASS_PROBABILITY, probability: cached.probability, source: 'cached' };
      this.#store(k, userId, sittingId, r);
      return done(r);
    }
    const slot = `${userId}|${sittingId}|${k}|${index}`;
    if (this.#asked.has(slot)) return done({ legit: null, probability: null, source: 'rate-limited' });
    this.#asked.add(slot);
    if (this.#asked.size > 5000) this.#asked = new Set([...this.#asked].slice(-2500));

    if (!this.#gateway || typeof this.#gateway.evaluate !== 'function') {
      this.#logger.warn?.('piano.lesson-legit.fallback', { reason: 'no-gateway' });
      return done({ legit: null, probability: null, source: 'fallback' });
    }
    try {
      const call = this.#gateway.evaluate(
        { notes, stats },
        { legit: { type: 'yesNo', instructions: preschool ? PRESCHOOL_LEGIT_QUESTION : LEGIT_QUESTION } },
        { timeout: this.#timeoutMs },
      );
      const res = this.#scheduler?.withDeadline
        ? await this.#scheduler.withDeadline(call, { milliseconds: this.#timeoutMs, description: 'timeout' })
        : await call;
      const p = Number(res?.answers?.legit?.probability);
      if (!Number.isFinite(p)) throw new Error('no probability');
      const probability = Math.round(p * 1000) / 1000;
      this.#cache.set(burstKey, { probability });
      const r = { legit: probability >= LEGIT_PASS_PROBABILITY, probability, source: 'model' };
      this.#store(k, userId, sittingId, r);
      return done(r, { model: res?.model ?? null });
    } catch (err) {
      this.#logger.warn?.('piano.lesson-legit.fallback', { reason: /timed out/.test(err.message) ? 'timeout' : 'error', error: err.message });
      return done({ legit: null, probability: null, source: 'fallback' });
    }
  }
}

export default JudgeNoteBurst;
