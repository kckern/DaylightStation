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
      throw new Error('TransactionCategorizationService requires aiGateway');
    }
    if (!transactionSource) {
      throw new Error('TransactionCategorizationService requires transactionSource');
    }
    if (!financeStore) {
      throw new Error('TransactionCategorizationService requires financeStore');
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

    const { validTags, chat: chatTemplate } = config;

    // Identify transactions that need processing
    const needsProcessing = transactions.filter(txn => this.#needsCategorization(txn));
    const skipped = transactions.filter(txn => !this.#needsCategorization(txn));

    this.#log('info', 'categorization.start', {
      total: transactions.length,
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
          await this.#transactionSource.updateTransaction(
            txn.id,
            result.friendlyName,
            result.category,
            result.memo
          );

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
      failed: failed.length
    });

    return { processed, failed, skipped };
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

    const { validTags, chat: chatTemplate } = config;
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

    return { suggestions, failed };
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
      const response = await this.#aiGateway.chatWithJson(messages, {
        model: 'gpt-4o'
      });

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
