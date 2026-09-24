/**
 * Meaning score for the Sentence Ladder's interpretation rung.
 *
 * `accuracy` is character edit distance, so "today the weather is nice"
 * against "The weather's nice today." scores 0.4 although the child plainly
 * understood the sentence. This judge asks a typed-decision model (the
 * IDecisionGateway port) where the answer sits on a five-level meaning rubric.
 *
 * RECORDED, NEVER GATING — like accuracy. Nothing reads it to decide credit.
 * Never throws: no gateway, a failure, a malformed answer or the deadline all
 * return null, and the caller then writes exactly the row it wrote before.
 *
 * Two code rules answer without a call: an exact copy (accuracy 1) is the top
 * level, and an answer with no letters in any script is the bottom one.
 *
 * The deadline is enforced twice: the gateway gets `timeout`, and, when an
 * IApplicationScheduler is injected, its `withDeadline` bounds the whole call
 * (the application layer may not hold global timers).
 */
import { score as scoreQuestion } from '#apps/common/ports/IDecisionGateway.mjs';

/** Ordered rubric, lowest first. The stored `score` is the level index ÷ 4. */
export const MEANING_LEVELS = Object.freeze([
  'Different meaning: unrelated, the wrong sentence, or not an answer at all',
  'Partly the same meaning: some of it is right, but part of the sense is missing or wrong',
  'The same meaning, except one detail is wrong (a word, a number, who, or when)',
  'The same meaning in different words',
  'The same words as `reference`',
]);

const INSTRUCTIONS = 'A child heard a sentence in the language they are learning and wrote what it means. '
  + '`reference` is the correct translation and `answer` is what the child wrote. '
  + 'How closely does `answer` carry the meaning of `reference`? '
  + 'Ignore spelling, spacing, punctuation, capital letters and contractions.';

const QUESTION = scoreQuestion(INSTRUCTIONS, [...MEANING_LEVELS]);
const TOP = MEANING_LEVELS.length - 1;
const DEFAULT_TIMEOUT_MS = 1500;
const round3 = (n) => Math.round(n * 1000) / 1000;

export class SentenceMeaningJudge {
  #decision; #timeoutMs; #scheduler; #logger;

  constructor({ decisionGateway = null, timeoutMs = DEFAULT_TIMEOUT_MS, scheduler = null, logger = console } = {}) {
    this.#decision = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#timeoutMs = timeoutMs;
    this.#scheduler = typeof scheduler?.withDeadline === 'function' ? scheduler : null;
    this.#logger = logger;
  }

  get enabled() { return Boolean(this.#decision); }

  /**
   * @param {{given: string, expected: string, language?: string|null, accuracy?: number|null}} args
   * @returns {Promise<null|{score:number, level:number, confidence:number|null, judge:string, model?:string|null, ms?:number}>}
   */
  async judge({ given, expected, language = null, accuracy = null }) {
    if (!this.#decision) return null;
    if (accuracy === 1) return { score: 1, level: TOP, confidence: 1, judge: 'exact' };
    if (!/\p{L}/u.test(String(given ?? ''))) return { score: 0, level: 0, confidence: 1, judge: 'no-words' };

    const startedAt = Date.now();
    try {
      const call = this.#decision.evaluate(
        { reference: expected, answer: given, language },
        { meaning: QUESTION },
        { timeout: this.#timeoutMs },
      );
      const result = await (this.#scheduler
        ? this.#scheduler.withDeadline(call, {
          milliseconds: this.#timeoutMs,
          errorFactory: () => new Error(`timed out after ${this.#timeoutMs}ms`),
        })
        : call);
      const answer = result?.answers?.meaning;
      if (answer?.type !== 'score' || !Number.isFinite(answer.score)) throw new Error('malformed answer');
      const level = Math.min(TOP, Math.max(0, answer.score));
      return {
        score: round3(level / TOP),
        level: Math.round(level),
        confidence: Number.isFinite(answer.confidence) ? round3(answer.confidence) : null,
        judge: 'model',
        model: result.model ?? null,
        ms: Date.now() - startedAt,
      };
    } catch (error) {
      this.#logger.warn?.('school.language.meaning-failed', { error: error.message, ms: Date.now() - startedAt });
      return null;
    }
  }
}

export default SentenceMeaningJudge;
