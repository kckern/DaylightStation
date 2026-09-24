/**
 * TransactionCategorizationService - AI-powered transaction categorization
 *
 * Uses IAIGateway to automatically categorize and clean up transaction
 * descriptions using AI. Identifies transactions that need processing based on:
 * - Missing tags
 * - Raw/unclean descriptions (containing payment processor artifacts)
 *
 * Dependencies:
 * - IAIGateway: AI service for categorization
 * - ITransactionSource: For updating transactions in external system
 * - YamlFinanceStore: For reading categorization config
 */

import { ValidationError } from '#apps/common/errors/SemanticErrors.mjs';
import { TransactionCategoryJudge } from './TransactionCategoryJudge.mjs';

// jev.mode in the categorization config: shadow (default) logs Jev beside the
// LLM; promote lets Jev's category win at confidence >= confidenceFloor; off asks nothing.
const JEV_MODES = new Set(['shadow', 'promote', 'off']);
const DEFAULT_JEV_FLOOR = 0.8;

export class TransactionCategorizationService {
  #aiGateway;
  #transactionSource;
  #financeStore;
  #logger;
  #categoryJudge;
  // Bad jev policy configs already warned about (config is re-read every run)
  #warnedJevPolicies = new Set();

  // id → the description this service wrote when that description still looks
  // raw to the patterns below (e.g. "Direct Deposit" vs /^Direct/). Without it
  // the next harvest re-sends the row to the LLM forever. In-process only: a
  // restart costs one re-ask per such row.
  #settled = new Map();

  // Patterns that indicate raw/unprocessed descriptions
  #rawDescriptionPatterns = [
    /^Direct/i,
    /Pwp/i,
    /^xx/i,
    /as of/i,
    /\*/,
    /（/,
    /Privacycom/i
  ];

  /**
   * @param {Object} deps - Dependencies
   * @param {Object} deps.aiGateway - IAIGateway implementation
   * @param {Object} deps.transactionSource - ITransactionSource implementation
   * @param {Object} deps.financeStore - YamlFinanceStore instance
   * @param {Object} [deps.decisionGateway] - IDecisionGateway (optional; Jev category shadow/promotion)
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ aiGateway, transactionSource, financeStore, decisionGateway = null, logger }) {
    if (!aiGateway) {
      throw new ValidationError('TransactionCategorizationService requires aiGateway', { field: 'aiGateway' });
    }
    if (!transactionSource) {
      throw new ValidationError('TransactionCategorizationService requires transactionSource', { field: 'transactionSource' });
    }
    if (!financeStore) {
      throw new ValidationError('TransactionCategorizationService requires financeStore', { field: 'financeStore' });
    }
    this.#aiGateway = aiGateway;
    this.#transactionSource = transactionSource;
    this.#financeStore = financeStore;
    this.#logger = logger || console;
    this.#categoryJudge = new TransactionCategoryJudge({ decisionGateway, logger: this.#logger });
  }

  /**
   * Process and categorize transactions that need attention
   *
   * @param {Object[]} transactions - Transactions to process
   * @param {string} [householdId] - Household ID for config
   * @returns {Promise<{processed: Object[], failed: Object[], skipped: Object[]}>}
   */
  async categorize(transactions, householdId) {
    const config = this.#financeStore.getCategorizationConfig(householdId);
    if (!config?.validTags) {
      this.#log('warn', 'categorization.config.missing');
      return { processed: [], failed: [], skipped: transactions };
    }

    const { validTags, chat: chatTemplate, descriptionRules } = config;
    const policy = this.#jevPolicy(config);

    // Apply deterministic description rules before AI categorization
    const ruleResults = this.#applyDescriptionRules(transactions, descriptionRules);

    // Identify transactions that need processing (after rules applied)
    const needsProcessing = transactions.filter(txn => this.#needsCategorization(txn));
    const skipped = transactions.filter(txn => !this.#needsCategorization(txn));

    this.#log('info', 'categorization.start', {
      total: transactions.length,
      rulesApplied: ruleResults.length,
      toProcess: needsProcessing.length,
      skipped: skipped.length
    });

    const processed = [];
    const failed = [];

    for (const txn of needsProcessing) {
      try {
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate, { policy, path: 'apply' });

        if (result.success) {
          // Update transaction in external system
          await this.#transactionSource.updateTransaction(txn.id, {
            description: result.friendlyName,
            tags: result.category,
            memo: result.memo
          });

          // Update local transaction object
          txn.tagNames = [result.category];
          txn.description = result.friendlyName;
          if (result.memo) txn.memo = result.memo;
          if (this.#hasRawDescription(result.friendlyName)) {
            this.#settled.set(String(txn.id), result.friendlyName);
            this.#log('info', 'categorization.settled', { id: txn.id, friendlyName: result.friendlyName });
          }

          processed.push({
            id: txn.id,
            date: txn.date,
            originalDescription: result.originalDescription,
            friendlyName: result.friendlyName,
            category: result.category,
            categoryVia: result.categoryVia
          });

          this.#log('info', 'categorization.success', {
            id: txn.id,
            date: txn.date,
            friendlyName: result.friendlyName,
            category: result.category,
            categoryVia: result.categoryVia
          });
        } else {
          failed.push({
            id: txn.id,
            date: txn.date,
            description: txn.description,
            reason: result.reason
          });

          this.#log('warn', 'categorization.failed', {
            id: txn.id,
            date: txn.date,
            description: txn.description,
            reason: result.reason
          });
        }
      } catch (error) {
        failed.push({
          id: txn.id,
          date: txn.date,
          description: txn.description,
          reason: error.message
        });

        this.#log('error', 'categorization.error', {
          id: txn.id,
          error: error.message
        });
      }
    }

    this.#log('info', 'categorization.complete', {
      processed: processed.length,
      failed: failed.length,
      rulesApplied: ruleResults.length
    });

    return { processed: [...ruleResults, ...processed], failed, skipped };
  }

  /**
   * Categorize a batch of transactions without updating external system
   * Useful for preview/dry-run mode
   *
   * @param {Object[]} transactions - Transactions to categorize
   * @param {string} [householdId] - Household ID for config
   * @returns {Promise<{suggestions: Object[], failed: Object[]}>}
   */
  async preview(transactions, householdId) {
    const config = this.#financeStore.getCategorizationConfig(householdId);
    if (!config?.validTags) {
      return { suggestions: [], failed: [] };
    }

    const { validTags, chat: chatTemplate, descriptionRules } = config;
    const policy = this.#jevPolicy(config);

    // Simulate each rule on a copy, so the LLM step sees exactly the rows (and
    // descriptions) that categorize() would send. Preview never mutates input.
    const compiled = this.#compileRules(descriptionRules);
    const ruleMatches = [];
    const simulated = transactions.map(txn => {
      const desc = txn.description || '';
      const rule = this.#matchRule(desc, compiled);
      if (!rule) return txn;
      ruleMatches.push({
        id: txn.id, date: txn.date, originalDescription: desc,
        suggestedName: rule.rename, suggestedCategory: rule.tag || txn.tagNames?.[0], source: 'rule',
      });
      return { ...txn, description: rule.rename, ...(rule.tag ? { tagNames: [rule.tag], tags: rule.tag } : {}) };
    });

    const needsProcessing = simulated.filter(txn => this.#needsCategorization(txn));

    const suggestions = [];
    const failed = [];

    for (const txn of needsProcessing) {
      try {
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate, { policy, path: 'preview' });

        if (result.success) {
          suggestions.push({
            id: txn.id,
            date: txn.date,
            originalDescription: txn.description,
            suggestedName: result.friendlyName,
            suggestedCategory: result.category,
            suggestedMemo: result.memo,
            categoryVia: result.categoryVia
          });
        } else {
          failed.push({
            id: txn.id,
            date: txn.date,
            description: txn.description,
            reason: result.reason
          });
        }
      } catch (error) {
        failed.push({
          id: txn.id,
          date: txn.date,
          description: txn.description,
          reason: error.message
        });
      }
    }

    return { suggestions: [...ruleMatches, ...suggestions], failed };
  }

  /**
   * Apply deterministic description rules to transactions.
   * Rules match against the original description and rename + retag without AI.
   * Updates both local transaction objects and the external source.
   *
   * @param {Object[]} transactions - Transactions to check
   * @param {Object[]} [rules] - Description rules from config
   * @returns {Object[]} List of transactions that were updated by rules
   */
  #applyDescriptionRules(transactions, rules) {
    const compiled = this.#compileRules(rules);
    if (!compiled.length) return [];
    const applied = [];

    for (const txn of transactions) {
      const originalDescription = txn.description || '';
      const rule = this.#matchRule(originalDescription, compiled);
      if (!rule) continue;

      txn.description = rule.rename;
      if (rule.tag) {
        txn.tagNames = [rule.tag];
        txn.tags = rule.tag;
      }

      // Update in external source (fire and forget)
      const update = { description: rule.rename };
      if (rule.tag) update.tags = rule.tag;
      this.#transactionSource.updateTransaction(txn.id, update).catch(err => {
        this.#log('error', 'categorization.rule.updateFailed', { id: txn.id, error: err.message });
      });

      applied.push({ id: txn.id, date: txn.date, originalDescription, friendlyName: rule.rename, category: rule.tag || txn.tagNames?.[0] });
      this.#log('info', 'categorization.rule.applied', { id: txn.id, from: originalDescription, to: rule.rename });
    }

    return applied;
  }

  #compileRules(rules) {
    return (rules || []).map(r => ({ pattern: new RegExp(r.pattern, 'i'), rename: r.rename, tag: r.tag }));
  }

  /** First matching rule wins; a description already equal to its rename matches nothing. */
  #matchRule(description, compiled) {
    const rule = compiled.find(r => r.pattern.test(description));
    return rule && description !== rule.rename ? rule : null;
  }

  /**
   * Check if a transaction needs categorization
   *
   * @param {Object} transaction - Transaction to check
   * @returns {boolean}
   */
  #needsCategorization(transaction) {
    const hasNoTag = !transaction.tagNames?.length;
    if (!hasNoTag && this.#settled.get(String(transaction.id)) === transaction.description) return false;
    const hasRawDescription = this.#hasRawDescription(transaction.description);
    return hasNoTag || hasRawDescription;
  }

  /**
   * Check if description contains raw/unprocessed patterns
   *
   * @param {string} description - Transaction description
   * @returns {boolean}
   */
  #hasRawDescription(description) {
    if (!description) return false;
    return this.#rawDescriptionPatterns.some(pattern => pattern.test(description));
  }

  #jevPolicy(config) {
    const jev = config?.jev || {};
    const modeOk = jev.mode === undefined || JEV_MODES.has(jev.mode);
    const floorOk = jev.confidenceFloor === undefined
      || (Number.isFinite(jev.confidenceFloor) && jev.confidenceFloor >= 0 && jev.confidenceFloor <= 1);

    if (!modeOk || !floorOk) {
      const key = JSON.stringify([String(jev.mode), String(jev.confidenceFloor)]);
      if (!this.#warnedJevPolicies.has(key)) {
        this.#warnedJevPolicies.add(key);
        this.#log('warn', 'categorization.jev.policy.invalid', {
          mode: jev.mode ?? null,
          confidenceFloor: jev.confidenceFloor ?? null,
          using: { mode: modeOk ? (jev.mode ?? 'shadow') : 'shadow', floor: floorOk ? (jev.confidenceFloor ?? DEFAULT_JEV_FLOOR) : DEFAULT_JEV_FLOOR },
        });
      }
    }
    return {
      mode: modeOk && jev.mode !== undefined ? jev.mode : 'shadow',
      floor: floorOk && jev.confidenceFloor !== undefined ? jev.confidenceFloor : DEFAULT_JEV_FLOOR,
    };
  }

  /**
   * Categorize one transaction: the LLM names it (and proposes a category);
   * Jev independently picks a category from validTags, in parallel. Both
   * the apply and the preview path come through here, so they decide alike.
   *
   * @returns {Promise<Object>} { success, friendlyName, category, categoryVia, memo, originalDescription } on success; { success, reason, originalDescription } with success set to false otherwise
   */
  async #categorizeTransaction(transaction, validTags, chatTemplate, { policy, path }) {
    const { description, id } = transaction;
    const jevPending = policy.mode === 'off'
      ? Promise.resolve(null)
      // judge() is written never to reject; the catch keeps an unobserved
      // rejection (while the LLM is awaited) from crashing the process if it ever does.
      : this.#categoryJudge.judge(transaction, validTags).catch(() => null);
    const llm = await this.#askLlm(transaction, validTags, chatTemplate);
    const jev = await jevPending;
    const outcome = this.#decide(llm, jev, validTags, policy, description);

    if (jev) {
      this.#log('info', 'categorization.jev.compare', {
        id, path, mode: policy.mode, floor: policy.floor,
        llmCategory: llm.category ?? null,
        llmValid: validTags.includes(llm.category),
        llmError: !!llm.error,
        jevCategory: jev.category,
        confidence: jev.confidence,
        agreed: jev.category != null && jev.category === llm.category,
        via: outcome.success ? outcome.categoryVia : null,
        cjk: jev.cjk, model: jev.model, jevMs: jev.ms,
      });
    }
    return outcome;
  }

  async #askLlm(transaction, validTags, chatTemplate) {
    const messages = chatTemplate.map(msg => {
      if (msg.role === 'system' && msg.content.includes('__VALID_TAGS__')) {
        return { role: msg.role, content: msg.content.replace('__VALID_TAGS__', JSON.stringify(validTags)) };
      }
      return msg;
    });
    messages.push({ role: 'user', content: transaction.description });

    try {
      const response = await this.#aiGateway.chatWithJson(messages);
      // Plain destructure (no ?.): a null response stays an "AI error", as before.
      const { category, friendlyName, memo } = response;
      return { category, friendlyName, memo };
    } catch (error) {
      this.#logger.warn?.('categorization.ai.failed', { transactionId: transaction.id, error: error.message });
      return { error: error.message };
    }
  }

  #decide(llm, jev, validTags, policy, originalDescription) {
    if (llm.error) return { success: false, reason: `AI error: ${llm.error}`, originalDescription };
    if (!llm.friendlyName) return { success: false, reason: 'AI did not provide a friendly name', originalDescription };
    // promote: a confident Jev pick from validTags wins, and rescues a blank or
    // invalid LLM category. The LLM still names and memos. Number.isFinite keeps
    // a null confidence from passing a floor of 0 (null >= 0 is true in JS).
    if (policy.mode === 'promote' && jev && validTags.includes(jev.category)
      && Number.isFinite(jev.confidence) && jev.confidence >= policy.floor) {
      return {
        success: true, friendlyName: llm.friendlyName, category: jev.category, categoryVia: 'jev',
        memo: llm.memo || null, originalDescription,
      };
    }
    if (!validTags.includes(llm.category)) {
      return { success: false, reason: `Invalid category: ${llm.category}`, originalDescription };
    }
    return {
      success: true, friendlyName: llm.friendlyName, category: llm.category, categoryVia: 'llm',
      memo: llm.memo || null, originalDescription,
    };
  }

  /**
   * Add custom patterns for raw description detection
   *
   * @param {RegExp[]} patterns - Additional patterns to check
   */
  addRawDescriptionPatterns(patterns) {
    this.#rawDescriptionPatterns.push(...patterns);
  }

  /**
   * Get list of transactions needing categorization
   *
   * @param {Object[]} transactions - Transactions to check
   * @returns {Object[]} Transactions needing categorization
   */
  getUncategorized(transactions) {
    return transactions.filter(txn => this.#needsCategorization(txn));
  }

  #log(level, message, data = {}) {
    if (this.#logger[level]) {
      this.#logger[level](message, data);
    }
  }
}

export default TransactionCategorizationService;
