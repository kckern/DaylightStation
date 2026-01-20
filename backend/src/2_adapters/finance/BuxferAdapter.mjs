/**
 * BuxferAdapter - Adapter for Buxfer financial API
 * Implements ITransactionSource port
 */

import { Transaction } from '../../1_domains/finance/entities/Transaction.mjs';
import { Account } from '../../1_domains/finance/entities/Account.mjs';

const BUXFER_API_BASE = 'https://www.buxfer.com/api';

export class BuxferAdapter {
  constructor({ httpClient, getCredentials, logger }) {
    this.httpClient = httpClient;
    this.getCredentials = getCredentials;
    this.logger = logger || console;
    this.token = null;
    this.tokenExpiresAt = 0;

    // Metrics
    this.metrics = {
      startedAt: Date.now(),
      requests: 0,
      errors: 0,
      lastRequestAt: null
    };
  }

  /**
   * Authenticate and get API token
   * @returns {Promise<string>} API token
   */
  async getToken() {
    // Return cached token if still valid (tokens typically last 24h)
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    const credentials = this.getCredentials();
    if (!credentials?.email || !credentials?.password) {
      throw new Error('Buxfer credentials not configured');
    }

    const url = `${BUXFER_API_BASE}/login`;
    const params = {
      email: credentials.email,
      password: credentials.password
    };

    try {
      this.metrics.requests++;
      this.metrics.lastRequestAt = Date.now();

      const { data } = await this.httpClient.post(url, params);

      if (!data?.response?.token) {
        throw new Error('No token in login response');
      }

      this.token = data.response.token;
      // Token expires in 24 hours, refresh 1 hour early
      this.tokenExpiresAt = Date.now() + (23 * 60 * 60 * 1000);

      this.logger.info?.('buxfer.authenticated', { expiresAt: this.tokenExpiresAt });
      return this.token;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('buxfer.auth_failed', { error: error.message });
      throw new Error(`Buxfer authentication failed: ${error.message}`);
    }
  }

  /**
   * Make authenticated API request
   * @param {string} endpoint - API endpoint
   * @param {Object} params - Query parameters
   * @param {string} method - HTTP method
   * @returns {Promise<Object>} API response
   */
  async request(endpoint, params = {}, method = 'GET') {
    const token = await this.getToken();
    const url = `${BUXFER_API_BASE}/${endpoint}?token=${token}`;

    this.metrics.requests++;
    this.metrics.lastRequestAt = Date.now();

    try {
      let response;
      if (method === 'GET') {
        const queryString = new URLSearchParams(params).toString();
        const fullUrl = queryString ? `${url}&${queryString}` : url;
        response = await this.httpClient.get(fullUrl);
      } else {
        response = await this.httpClient.post(url, params);
      }
      return response.data?.response;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('buxfer.request_failed', { endpoint, error: error.message });
      throw error;
    }
  }

  // ============ ITransactionSource Implementation ============

  /**
   * Find transactions by category
   * @param {string} category - Category/tag name
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Transaction[]>}
   */
  async findByCategory(category, startDate, endDate) {
    const rawTransactions = await this.getTransactions({
      startDate,
      endDate,
      tagName: category
    });

    return rawTransactions.map(this.mapToTransaction.bind(this));
  }

  /**
   * Find transactions in date range
   * @param {string} startDate - Start date (YYYY-MM-DD)
   * @param {string} endDate - End date (YYYY-MM-DD)
   * @returns {Promise<Transaction[]>}
   */
  async findInRange(startDate, endDate) {
    const rawTransactions = await this.getTransactions({ startDate, endDate });
    return rawTransactions.map(this.mapToTransaction.bind(this));
  }

  /**
   * Find transactions by account
   * @param {string} accountName - Account name
   * @returns {Promise<Transaction[]>}
   */
  async findByAccount(accountName) {
    const rawTransactions = await this.getTransactions({
      accounts: [accountName]
    });
    return rawTransactions.map(this.mapToTransaction.bind(this));
  }

  // ============ Buxfer-specific Methods ============

  /**
   * Get transactions from Buxfer API
   * @param {Object} options - Query options
   * @param {string} options.startDate - Start date (YYYY-MM-DD)
   * @param {string} options.endDate - End date (YYYY-MM-DD)
   * @param {string[]} options.accounts - Account names to query
   * @param {string} options.tagName - Filter by tag
   * @returns {Promise<Object[]>} Raw Buxfer transactions
   */
  async getTransactions({ startDate, endDate, accounts, tagName } = {}) {
    startDate = startDate || this.getDefaultStartDate();
    endDate = endDate || this.getDefaultEndDate();
    accounts = accounts || [];

    let allTransactions = [];

    // If no accounts specified, fetch all
    if (accounts.length === 0) {
      const accountList = await this.getAccounts();
      accounts = accountList.map(a => a.name);
    }

    for (const account of accounts) {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const params = { page, accountName: account, startDate, endDate };
        if (tagName) params.tagName = tagName;

        const response = await this.request('transactions', params);
        const transactions = response?.transactions || [];

        allTransactions = [...allTransactions, ...transactions];

        if (transactions.length === 0) {
          hasMore = false;
        } else {
          page++;
        }
      }
    }

    // Sort by date descending
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    this.logger.debug?.('buxfer.transactions_fetched', {
      count: allTransactions.length,
      accounts: accounts.length,
      startDate,
      endDate
    });

    return allTransactions;
  }

  /**
   * Get all accounts from Buxfer
   * @returns {Promise<Object[]>} Raw Buxfer accounts
   */
  async getAccounts() {
    const response = await this.request('accounts');
    return response?.accounts || [];
  }

  /**
   * Get account balances
   * @param {string[]} accountNames - Account names to query
   * @returns {Promise<Account[]>} Account entities with balances
   */
  async getAccountBalances(accountNames = []) {
    const allAccounts = await this.getAccounts();

    const filtered = accountNames.length > 0
      ? allAccounts.filter(a => accountNames.includes(a.name))
      : allAccounts;

    return filtered.map(a => new Account({
      id: a.id,
      name: a.name,
      type: this.mapAccountType(a.type),
      balance: a.balance,
      currency: a.currency || 'USD',
      institution: a.bank || null,
      lastUpdated: new Date().toISOString()
    }));
  }

  /**
   * Update a transaction
   * @param {string} id - Transaction ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated transaction
   */
  async updateTransaction(id, { description, tags, memo }) {
    const params = { id };
    if (description) params.description = description;
    if (tags) params.tags = Array.isArray(tags) ? tags.join(',') : tags;
    if (memo) params.memo = memo;

    try {
      const response = await this.request('transaction_edit', params, 'POST');
      this.logger.info?.('buxfer.transaction_updated', { id });
      return response;
    } catch (error) {
      this.logger.error?.('buxfer.update_failed', { id, error: error.message });
      throw error;
    }
  }

  /**
   * Add a new transaction
   * @param {Object} transaction - Transaction data
   * @returns {Promise<Object>} Created transaction
   */
  async addTransaction({
    accountId,
    amount,
    date,
    description,
    tags = [],
    type = 'expense',
    status = 'cleared',
    toAccountId,
    fromAccountId
  }) {
    const params = {
      accountId,
      amount,
      date,
      description,
      tags: Array.isArray(tags) ? tags.join(',') : tags,
      type,
      status
    };

    if (toAccountId) params.toAccountId = toAccountId;
    if (fromAccountId) params.fromAccountId = fromAccountId;

    try {
      const response = await this.request('transaction_add', params, 'POST');
      this.logger.info?.('buxfer.transaction_added', { description, amount });
      return response;
    } catch (error) {
      this.logger.error?.('buxfer.add_failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Delete a transaction
   * @param {string} id - Transaction ID
   * @returns {Promise<Object>} Deletion result
   */
  async deleteTransaction(id) {
    try {
      const response = await this.request('transaction_delete', { id }, 'POST');
      this.logger.info?.('buxfer.transaction_deleted', { id });
      return response;
    } catch (error) {
      this.logger.error?.('buxfer.delete_failed', { id, error: error.message });
      throw error;
    }
  }

  // ============ Batch Processing ============

  /**
   * Process transactions: categorize via AI and delete matching rules
   * All configuration is passed as parameters - no hardcoded values.
   *
   * @param {Object} options - Processing options
   * @param {string} options.startDate - Start date (YYYY-MM-DD)
   * @param {string} options.endDate - End date (YYYY-MM-DD)
   * @param {string[]} options.accounts - Account names to process
   * @param {string[]} [options.validTags=[]] - Valid category tags for AI categorization
   * @param {string[]} [options.rawDescriptionPatterns=[]] - Regex patterns indicating raw descriptions needing cleanup
   * @param {Object[]} [options.autoDeleteRules=[]] - Rules for auto-deleting transactions
   * @param {string} options.autoDeleteRules[].descriptionPattern - Regex pattern to match description
   * @param {number} options.autoDeleteRules[].accountId - Account ID to match
   * @param {Object} [options.aiGateway] - AI gateway with categorize(description) method
   * @returns {Promise<Object[]>} Processed transactions (excluding deleted ones)
   */
  async processTransactions({
    startDate,
    endDate,
    accounts,
    validTags = [],
    rawDescriptionPatterns = [],
    autoDeleteRules = [],
    aiGateway = null
  }) {
    this.logger.info?.('buxfer.processTransactions.start', { startDate, endDate, accounts });

    // Fetch all transactions
    const transactions = await this.getTransactions({ startDate, endDate, accounts });

    // Build regex for raw description detection
    const rawPatternRegex = rawDescriptionPatterns.length > 0
      ? new RegExp(rawDescriptionPatterns.join('|'), 'i')
      : null;

    // Identify transactions needing AI categorization
    const needsProcessing = (txn) => {
      const noTags = !txn.tagNames || txn.tagNames.length === 0;
      const hasRawDescription = rawPatternRegex && rawPatternRegex.test(txn.description);
      return noTags || hasRawDescription;
    };

    // Process transactions with AI if gateway provided
    if (aiGateway && validTags.length > 0) {
      const toProcess = transactions.filter(needsProcessing);
      this.logger.info?.('buxfer.processTransactions.categorizing', { count: toProcess.length });

      for (const txn of toProcess) {
        try {
          const result = await aiGateway.categorize(txn.description);
          const { category, friendlyName, memo } = result || {};

          if (friendlyName && validTags.includes(category)) {
            await this.updateTransaction(txn.id, {
              description: friendlyName,
              tags: category,
              memo
            });

            // Update local copy
            txn.description = friendlyName;
            txn.tagNames = [category];
            this.logger.info?.('buxfer.processTransactions.categorized', {
              id: txn.id,
              category,
              friendlyName
            });
          } else {
            this.logger.warn?.('buxfer.processTransactions.invalidCategory', {
              id: txn.id,
              category,
              validTags
            });
          }
        } catch (error) {
          this.logger.error?.('buxfer.processTransactions.aiError', {
            id: txn.id,
            error: error.message
          });
        }
      }
    }

    // Apply auto-delete rules
    const deleteIds = new Set();
    for (const rule of autoDeleteRules) {
      const pattern = new RegExp(rule.descriptionPattern, 'i');
      for (const txn of transactions) {
        if (pattern.test(txn.description) && txn.accountId === rule.accountId) {
          deleteIds.add(txn.id);
        }
      }
    }

    // Delete matching transactions
    for (const id of deleteIds) {
      try {
        await this.deleteTransaction(id);
        this.logger.info?.('buxfer.processTransactions.deleted', { id });
      } catch (error) {
        this.logger.error?.('buxfer.processTransactions.deleteError', {
          id,
          error: error.message
        });
      }
    }

    // Return transactions excluding deleted ones
    const result = transactions.filter(txn => !deleteIds.has(txn.id));
    this.logger.info?.('buxfer.processTransactions.complete', {
      total: transactions.length,
      deleted: deleteIds.size,
      returned: result.length
    });

    return result;
  }

  // ============ Helper Methods ============

  /**
   * Map raw Buxfer transaction to Transaction entity
   * @param {Object} raw - Raw Buxfer transaction
   * @returns {Transaction}
   */
  mapToTransaction(raw) {
    return new Transaction({
      id: raw.id?.toString(),
      date: raw.date,
      amount: Math.abs(raw.amount),
      description: raw.description,
      category: raw.tagNames?.[0] || null,
      accountId: raw.accountId?.toString(),
      type: this.inferTransactionType(raw),
      tags: raw.tagNames || [],
      metadata: {
        memo: raw.memo,
        buxferId: raw.id,
        rawType: raw.type
      }
    });
  }

  /**
   * Infer transaction type from Buxfer data
   * @param {Object} raw - Raw transaction
   * @returns {string} 'expense', 'income', or 'transfer'
   */
  inferTransactionType(raw) {
    if (raw.type === 'transfer') return 'transfer';
    if (raw.type === 'income' || raw.amount > 0) return 'income';
    return 'expense';
  }

  /**
   * Map Buxfer account type to domain type
   * @param {string} buxferType - Buxfer account type
   * @returns {string} Domain account type
   */
  mapAccountType(buxferType) {
    const typeMap = {
      'checking': 'checking',
      'savings': 'savings',
      'credit card': 'credit',
      'investment': 'investment',
      'loan': 'loan',
      'cash': 'checking',
      'other': 'checking'
    };
    return typeMap[buxferType?.toLowerCase()] || 'checking';
  }

  /**
   * Get default start date (1 year ago)
   * @returns {string} Date in YYYY-MM-DD format
   */
  getDefaultStartDate() {
    const date = new Date();
    date.setFullYear(date.getFullYear() - 1);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get default end date (today)
   * @returns {string} Date in YYYY-MM-DD format
   */
  getDefaultEndDate() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Get adapter metrics
   * @returns {Object} Metrics data
   */
  getMetrics() {
    return {
      uptime: {
        ms: Date.now() - this.metrics.startedAt,
        formatted: this.formatDuration(Date.now() - this.metrics.startedAt)
      },
      totals: {
        requests: this.metrics.requests,
        errors: this.metrics.errors
      },
      authenticated: !!this.token,
      tokenExpiresAt: this.tokenExpiresAt > 0 ? new Date(this.tokenExpiresAt).toISOString() : null,
      lastRequestAt: this.metrics.lastRequestAt
        ? new Date(this.metrics.lastRequestAt).toISOString()
        : null
    };
  }

  /**
   * Format duration in human-readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  /**
   * Check if adapter is properly configured
   * @returns {boolean}
   */
  isConfigured() {
    const credentials = this.getCredentials();
    return !!(credentials?.email && credentials?.password);
  }
}

export default BuxferAdapter;
