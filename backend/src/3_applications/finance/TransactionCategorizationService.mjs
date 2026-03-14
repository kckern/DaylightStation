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

import { ValidationError } from '#system/utils/errors/index.mjs';

export class TransactionCategorizationService {
  #aiGateway;
  #transactionSource;
  #financeStore;
  #logger;

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
   * @param {Object} [deps.logger] - Logger instance
   */
  constructor({ aiGateway, transactionSource, financeStore, logger }) {
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
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate);

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

          processed.push({
            id: txn.id,
            date: txn.date,
            originalDescription: result.originalDescription,
            friendlyName: result.friendlyName,
            category: result.category
          });

          this.#log('info', 'categorization.success', {
            id: txn.id,
            date: txn.date,
            friendlyName: result.friendlyName,
            category: result.category
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

    // Preview deterministic rules (without updating external source)
    const ruleMatches = [];
    if (descriptionRules?.length) {
      const compiled = descriptionRules.map(r => ({
        pattern: new RegExp(r.pattern, 'i'),
        rename: r.rename,
        tag: r.tag
      }));
      for (const txn of transactions) {
        const desc = txn.description || '';
        for (const rule of compiled) {
          if (rule.pattern.test(desc) && desc !== rule.rename) {
            ruleMatches.push({
              id: txn.id,
              date: txn.date,
              originalDescription: desc,
              suggestedName: rule.rename,
              suggestedCategory: rule.tag || txn.tagNames?.[0],
              source: 'rule'
            });
            break;
          }
        }
      }
    }

    const needsProcessing = transactions.filter(txn => this.#needsCategorization(txn));

    const suggestions = [];
    const failed = [];

    for (const txn of needsProcessing) {
      try {
        const result = await this.#categorizeTransaction(txn, validTags, chatTemplate);

        if (result.success) {
          suggestions.push({
            id: txn.id,
            date: txn.date,
            originalDescription: txn.description,
            suggestedName: result.friendlyName,
            suggestedCategory: result.category,
            suggestedMemo: result.memo
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
    if (!rules?.length) return [];

    const compiled = rules.map(r => ({
      pattern: new RegExp(r.pattern, 'i'),
      rename: r.rename,
      tag: r.tag
    }));

    const applied = [];

    for (const txn of transactions) {
      const desc = txn.description || '';
      for (const rule of compiled) {
        if (!rule.pattern.test(desc)) continue;
        if (desc === rule.rename) break; // already renamed

        const originalDescription = desc;
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

        applied.push({
          id: txn.id,
          date: txn.date,
          originalDescription,
          friendlyName: rule.rename,
          category: rule.tag || txn.tagNames?.[0]
        });

        this.#log('info', 'categorization.rule.applied', {
          id: txn.id,
          from: originalDescription,
          to: rule.rename
        });

        break; // first matching rule wins
      }
    }

    return applied;
  }

  /**
   * Check if a transaction needs categorization
   *
   * @param {Object} transaction - Transaction to check
   * @returns {boolean}
   */
  #needsCategorization(transaction) {
    const hasNoTag = !transaction.tagNames?.length;
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

  /**
   * Categorize a single transaction using AI
   *
   * @param {Object} transaction - Transaction to categorize
   * @param {string[]} validTags - List of valid category tags
   * @param {Object[]} chatTemplate - Chat template from config
   * @returns {Promise<Object>}
   */
  async #categorizeTransaction(transaction, validTags, chatTemplate) {
    const { description, id, date } = transaction;

    // Build chat messages from template
    const messages = chatTemplate.map(msg => {
      if (msg.role === 'system' && msg.content.includes('__VALID_TAGS__')) {
        return {
          role: msg.role,
          content: msg.content.replace('__VALID_TAGS__', JSON.stringify(validTags))
        };
      }
      return msg;
    });

    // Add user message with transaction description
    messages.push({ role: 'user', content: description });

    try {
      const response = await this.#aiGateway.chatWithJson(messages);

      const { category, friendlyName, memo } = response;

      // Validate response
      if (!friendlyName) {
        return {
          success: false,
          reason: 'AI did not provide a friendly name',
          originalDescription: description
        };
      }

      if (!validTags.includes(category)) {
        return {
          success: false,
          reason: `Invalid category: ${category}`,
          originalDescription: description
        };
      }

      return {
        success: true,
        friendlyName,
        category,
        memo: memo || null,
        originalDescription: description
      };
    } catch (error) {
      return {
        success: false,
        reason: `AI error: ${error.message}`,
        originalDescription: description
      };
    }
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
