/**
 * Meaning score for the Sentence Ladder's interpretation rung, and — the same
 * judge, its own rubric — the dictation rung's `heard` score.
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
 * DICTATION (`kind: 'heard'`, owner ruling 2026-11-03: correctness, not
 * letters). The child typed the sentence they heard, in the language they are
 * learning. Character accuracy calls a valid other spelling, a different word
 * order or an equivalent wording a mismatch; this asks how right the sentence
 * is, and — a Choice beside it — how it matched (HEARD_MATCH_KINDS), so a
 * spelling slip can be told from a wrong word.
 *
 * Two code rules answer without a call: an exact copy (accuracy 1) is the top
 * level, and an answer with no letters in any script is the bottom one.
 *
 * The deadline is enforced twice: the gateway gets `timeout`, and, when an
 * IApplicationScheduler is injected, its `withDeadline` bounds the whole call
 * (the application layer may not hold global timers).
 */
import { choice as choiceQuestion, score as scoreQuestion } from '#apps/common/ports/IDecisionGateway.mjs';

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

/** Dictation: how right the typed sentence is, lowest first. */
export const HEARD_LEVELS = Object.freeze([
  'Wrong: a different sentence, or not an answer at all',
  'Partly right: some of the sentence is there, but much is missing or wrong',
  'Mostly right: one word wrong or missing',
  'Right, with spelling mistakes: clearly the sentence, misspelled or mistyped',
  'Fully right: the sentence of `reference` — spacing and punctuation aside, a valid other spelling, the same words in another order, or an equivalent wording that says exactly the same',
]);

/** How the typed sentence relates to `reference`'s wording. Informational only. */
export const HEARD_MATCH_KINDS = Object.freeze({
  identical: 'The same words as `reference` (spacing and punctuation aside)',
  reordered: 'The words of `reference` in a different order, meaning unchanged',
  equivalent: 'Different words that say exactly what `reference` says',
  misspelled: 'The sentence of `reference`, with spelling or typing mistakes',
  'missing-words': 'The sentence with a word or more missing or wrong',
  different: 'A different sentence, or not an answer',
});

const HEARD_INSTRUCTIONS = 'A child heard `reference` read aloud in `language`, the language they are learning, and typed `answer`. '
  + 'How right is the typed sentence? Grade correctness, not letters: spacing, punctuation, a valid other spelling, '
  + 'a different word order or an equivalent wording can be fully right.';
const HEARD_QUESTIONS = Object.freeze({
  heard: scoreQuestion(HEARD_INSTRUCTIONS, [...HEARD_LEVELS]),
  match: choiceQuestion('How does `answer` relate to the wording of `reference`?', { ...HEARD_MATCH_KINDS }),
});
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
   * @param {{given: string, expected: string, language?: string|null, accuracy?: number|null,
   *   kind?: 'meaning'|'heard', attempt?: {learnerId?: string, corpus?: string, seq?: number}|null}} args
   *   `kind` picks the rubric: `meaning` (interpretation, the default) or
   *   `heard` (dictation, which also answers `match`). `attempt` identifies the
   *   row being judged; it is only logged, never sent.
   * @returns {Promise<null|{score:number, level:number, confidence:number|null, judge:string, model?:string|null, ms?:number, match?:string}>}
   */
  async judge({ given, expected, language = null, accuracy = null, kind = 'meaning', attempt = null }) {
    if (!this.#decision) return null;
    const heard = kind === 'heard';
    if (accuracy === 1) return { score: 1, level: TOP, confidence: 1, judge: 'exact', ...(heard ? { match: 'identical' } : {}) };
    if (!/\p{L}/u.test(String(given ?? ''))) return { score: 0, level: 0, confidence: 1, judge: 'no-words', ...(heard ? { match: 'different' } : {}) };

    const startedAt = Date.now();
    try {
      const call = this.#decision.evaluate(
        { reference: expected, answer: given, language },
        heard ? HEARD_QUESTIONS : { meaning: QUESTION },
        { timeout: this.#timeoutMs },
      );
      const result = await (this.#scheduler
        ? this.#scheduler.withDeadline(call, {
          milliseconds: this.#timeoutMs,
          errorFactory: () => new Error(`timed out after ${this.#timeoutMs}ms`),
        })
        : call);
      const answer = result?.answers?.[heard ? 'heard' : 'meaning'];
      if (answer?.type !== 'score' || !Number.isFinite(answer.score)) throw new Error('malformed answer');
      const level = Math.min(TOP, Math.max(0, answer.score));
      const match = heard && typeof result.answers.match?.choice === 'string' && result.answers.match.choice in HEARD_MATCH_KINDS
        ? result.answers.match.choice : null;
      return {
        score: round3(level / TOP),
        level: Math.round(level),
        confidence: Number.isFinite(answer.confidence) ? round3(answer.confidence) : null,
        judge: 'model',
        model: result.model ?? null,
        ms: Date.now() - startedAt,
        ...(match ? { match } : {}),
      };
    } catch (error) {
      this.#logger.warn?.(heard ? 'school.language.heard-failed' : 'school.language.meaning-failed', {
        ...(attempt ?? {}), error: error.message, ms: Date.now() - startedAt,
      });
      return null;
    }
  }
}

export default SentenceMeaningJudge;
