/**
 * IDecisionGateway Port Interface
 *
 * Abstract interface for typed-decision models: evaluate one `state` against a
 * set of named questions whose possible answers are defined up front, and get
 * back calibrated probabilities instead of generated text.
 *
 * This is deliberately NOT IAIGateway. There are no messages and no strings to
 * parse — the answer space is fixed by the question, so a result can only be
 * one of the options the caller supplied.
 *
 * Question kinds (all can be mixed in one evaluate() call; each is judged
 * independently against the same state):
 *   yesNo   Is this statement true?        → probability 0..1
 *   choice  Which option from a set?       → choice + probabilities + confidence
 *   score   Where on an ordered rubric?    → score (fractional level index) + probabilities + confidence
 *
 * Questions should be atomic gut-checks. Anything that weighs several factors
 * belongs in several questions, combined by the caller.
 *
 * Implementations: JevAdapter (TypeSafe AI)
 */

/**
 * @typedef {string|Object|Array} Describable
 * Plain text, or structured data the question refers to by name in backticks.
 */

/**
 * @typedef {Object} YesNoQuestion
 * @property {'yesNo'} type
 * @property {Describable} instructions
 * @property {{ yes?: Describable, no?: Describable }} [criteria] - What yes / no mean
 */

/**
 * @typedef {Object} ChoiceQuestion
 * @property {'choice'} type
 * @property {Describable} instructions
 * @property {Object<string, Describable|null>} options - option key → description (null = self-explanatory).
 *   Any number ≥ 2; adapters absorb provider option caps.
 */

/**
 * @typedef {Object} ScoreQuestion
 * @property {'score'} type
 * @property {Describable} instructions
 * @property {Describable[]} levels - Ordered rubric, lowest first
 */

/** @typedef {YesNoQuestion|ChoiceQuestion|ScoreQuestion} DecisionQuestion */

/**
 * @typedef {Object} YesNoAnswer
 * @property {'yesNo'} type
 * @property {number} probability - Probability the answer is yes (0..1)
 */

/**
 * @typedef {Object} ChoiceAnswer
 * @property {'choice'} type
 * @property {string} choice - The selected option key
 * @property {number} confidence - 0..1
 * @property {Object<string, number>} probabilities - option key → probability. May cover only the
 *   options still in contention (an adapter that narrows a large option set reports the finalists).
 */

/**
 * @typedef {Object} ScoreAnswer
 * @property {'score'} type
 * @property {number} score - Probability-weighted level index (0 = first level)
 * @property {number} confidence - 0..1
 * @property {number[]} probabilities - Probability per level, same order as `levels`
 */

/** @typedef {YesNoAnswer|ChoiceAnswer|ScoreAnswer} DecisionAnswer */

/**
 * @typedef {Object} DecisionResult
 * @property {string} model - Versioned model id that answered (log it; aliases move)
 * @property {Object<string, DecisionAnswer>} answers - Keyed by the caller's question ids
 * @property {{ inputTokens: number|null, outputTokens: number|null }} usage
 */

/**
 * @typedef {Object} DecisionOptions
 * @property {string} [model] - Model to use (overrides default)
 * @property {number} [timeout] - Request timeout in ms
 */

/**
 * Abstract interface for typed-decision models
 * @interface IDecisionGateway
 */
export class IDecisionGateway {
  /**
   * Evaluate named questions against one state.
   * @param {string|Object|Array} state - The content to judge
   * @param {Object<string, DecisionQuestion>} questions - question id → question
   * @param {DecisionOptions} [options]
   * @returns {Promise<DecisionResult>}
   */
  async evaluate(state, questions, options = {}) {
    throw new Error('IDecisionGateway.evaluate must be implemented');
  }

  /**
   * A view of this gateway whose calls are attributed to `tags`
   * (`{ app, feature }`) in the AI usage ledger. Real adapters override this;
   * the default is the gateway itself, so a double that extends the port can
   * be scoped without doing anything.
   * @param {{app?: string, feature?: string}} [tags]
   * @returns {this}
   */
  scoped(tags = {}) {
    return this;
  }

  /**
   * Whether a provider is configured (NoOp returns false)
   * @returns {boolean}
   */
  isConfigured() {
    throw new Error('IDecisionGateway.isConfigured must be implemented');
  }
}

// Only the logical minimums live here. Provider limits (e.g. how many options
// one request may carry) are the adapter's problem, not the caller's.
const MIN_CHOICE_OPTIONS = 2;
const MIN_SCORE_LEVELS = 2;

/**
 * Build a yes/no question.
 * @param {Describable} instructions
 * @param {{ yes?: Describable, no?: Describable }} [criteria]
 * @returns {YesNoQuestion}
 */
export function yesNo(instructions, criteria) {
  requireInstructions(instructions);
  return criteria ? { type: 'yesNo', instructions, criteria } : { type: 'yesNo', instructions };
}

/**
 * Build a choice question.
 * @param {Describable} instructions
 * @param {Object<string, Describable|null>|string[]} options - map of key → description, or bare keys
 * @returns {ChoiceQuestion}
 */
export function choice(instructions, options) {
  requireInstructions(instructions);
  const map = Array.isArray(options)
    ? Object.fromEntries(options.map((key) => [key, null]))
    : options;
  const count = map && typeof map === 'object' ? Object.keys(map).length : 0;
  if (count < MIN_CHOICE_OPTIONS) {
    throw new Error(`choice() needs at least ${MIN_CHOICE_OPTIONS} options, got ${count}`);
  }
  return { type: 'choice', instructions, options: map };
}

/**
 * Build a score question.
 * @param {Describable} instructions
 * @param {Describable[]} levels - Ordered rubric, lowest first
 * @returns {ScoreQuestion}
 */
export function score(instructions, levels) {
  requireInstructions(instructions);
  const count = Array.isArray(levels) ? levels.length : 0;
  if (count < MIN_SCORE_LEVELS) {
    throw new Error(`score() needs at least ${MIN_SCORE_LEVELS} levels, got ${count}`);
  }
  return { type: 'score', instructions, levels };
}

function requireInstructions(instructions) {
  if (instructions == null || instructions === '') {
    throw new Error('Decision question requires instructions');
  }
}

/**
 * Check if object implements IDecisionGateway
 * @param {any} obj
 * @returns {boolean}
 */
export function isDecisionGateway(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return typeof obj.evaluate === 'function' && typeof obj.isConfigured === 'function';
}

/**
 * Assert that object implements IDecisionGateway
 * @template T
 * @param {T} gateway
 * @returns {T}
 */
export function assertDecisionGateway(gateway) {
  if (!isDecisionGateway(gateway)) {
    throw new Error('Object does not implement IDecisionGateway interface');
  }
  return gateway;
}

export default IDecisionGateway;
