/**
 * TransactionCategoryJudge — a typed decision model's pick of a transaction's
 * budget category from the household's `validTags`.
 *
 * One choice question per transaction. The answer can only be one of the
 * household's tags, which the LLM path cannot promise (it fails on a blank or
 * invented category). The judge decides nothing on its own:
 * TransactionCategorizationService logs it beside the LLM's pick (shadow) and
 * applies it only when the finance config promotes it.
 *
 * Never throws: no model, too few tags, or a failed call all return null,
 * which callers treat as "no opinion".
 */

import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const DEFAULT_TIMEOUT_MS = 5000;

const INSTRUCTIONS = 'Which budget category does this bank transaction belong to? '
  + '`description` is the raw bank or card description; it may carry payment-processor noise such as "Pwp", "Sq *", '
  + '"Privacycom" or reference numbers. `type` is how the bank classed it (expense, income, transfer, refund, '
  + 'dividend, investment sale), `amount` is the absolute amount, and `account` is the account it posted to.';

// Hangul, CJK ideographs and fullwidth forms: the provider's weaker scripts
const CJK = /[\u1100-\u11FF\u3000-\u303F\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;

export class TransactionCategoryJudge {
  #decisionGateway; #timeoutMs; #logger;

  /**
   * @param {Object} [deps]
   * @param {Object} [deps.decisionGateway] - IDecisionGateway
   * @param {number} [deps.timeoutMs=5000]
   * @param {Object} [deps.logger]
   */
  constructor({ decisionGateway = null, timeoutMs = DEFAULT_TIMEOUT_MS, logger = console } = {}) {
    this.#decisionGateway = decisionGateway?.isConfigured?.() === false ? null : decisionGateway;
    this.#timeoutMs = timeoutMs;
    this.#logger = logger;
  }

  get available() { return !!this.#decisionGateway; }

  /** The facts the model sees. No LLM output, so the two picks stay independent. */
  static stateFor(txn) {
    const amount = Number(txn.amount);
    return {
      description: txn.description || '',
      type: txn.type || txn.transactionType || null,
      amount: Number.isFinite(amount) ? Math.abs(amount) : null,
      account: txn.accountName || null,
      date: txn.date || null,
    };
  }

  /**
   * @param {Object} txn - Transaction (provider shape)
   * @param {string[]} validTags
   * @returns {Promise<null|{category: string|null, confidence: number|null, model: string|null, ms: number, cjk: boolean}>}
   */
  async judge(txn, validTags) {
    if (!this.#decisionGateway) return null;
    const tags = [...new Set(validTags || [])].filter(Boolean);
    if (tags.length < 2) return null;

    const state = TransactionCategoryJudge.stateFor(txn);
    const startedAt = Date.now();
    try {
      const result = await this.#decisionGateway.evaluate(state, { category: choice(INSTRUCTIONS, tags) },
        { timeout: this.#timeoutMs });
      const answer = result?.answers?.category;
      return {
        category: tags.includes(answer?.choice) ? answer.choice : null,
        confidence: answer?.confidence ?? null,
        model: result?.model ?? null,
        ms: Date.now() - startedAt,
        cjk: CJK.test(state.description),
      };
    } catch (error) {
      this.#logger.warn?.('categorization.jev.failed', { id: txn.id ?? null, error: error.message, ms: Date.now() - startedAt });
      return null;
    }
  }
}

export default TransactionCategoryJudge;
