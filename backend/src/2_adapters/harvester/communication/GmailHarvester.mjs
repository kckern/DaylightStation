/**
 * GmailHarvester
 *
 * Fetches user's email from Gmail API.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Inbox and sent mail fetching
 * - Date-keyed lifelog storage
 * - Current inbox state tracking
 * - OAuth token refresh
 *
 * @module harvester/communication/GmailHarvester
 */

import { google } from 'googleapis';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';

/**
 * Gmail email harvester
 * @implements {IHarvester}
 */
export class GmailHarvester extends IHarvester {
  #lifelogStore;
  #currentStore;
  #configService;
  #circuitBreaker;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.lifelogStore - Store for lifelog YAML
   * @param {Object} config.currentStore - Store for current inbox state
   * @param {Object} config.configService - ConfigService for credentials
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    lifelogStore,
    currentStore,
    configService,
    logger = console,
  }) {
    super();

    if (!lifelogStore) {
      throw new Error('GmailHarvester requires lifelogStore');
    }

    this.#lifelogStore = lifelogStore;
    this.#currentStore = currentStore;
    this.#configService = configService;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 5 * 60 * 1000,
      maxCooldownMs: 2 * 60 * 60 * 1000,
      logger: logger,
    });
  }

  get serviceId() {
    return 'gmail';
  }

  get category() {
    return HarvesterCategory.COMMUNICATION;
  }

  /**
   * Harvest emails from Gmail
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {number} [options.maxInbox=100] - Max inbox messages
   * @param {number} [options.maxSent=200] - Max sent messages
   * @returns {Promise<{ inbox: number, sent: number, status: string }>}
   */
  async harvest(username, options = {}) {
    const { maxInbox = 100, maxSent = 200 } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('gmail.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        inbox: 0,
        sent: 0,
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('gmail.harvest.start', { username, maxInbox, maxSent });

      // Create Gmail client
      const gmail = await this.#createGmailClient(username);

      // Fetch inbox and sent in parallel
      const [inboxMessages, sentMessages] = await Promise.all([
        this.#fetchInbox(gmail, maxInbox),
        this.#fetchSent(gmail, maxSent),
      ]);

      // Load existing lifelog
      const existingLifelog = await this.#lifelogStore.load(username, 'gmail') || {};
      const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;

      // Categorize and merge messages
      const today = new Date().toISOString().split('T')[0];
      const todaysReceived = inboxMessages
        .filter(m => m.date === today && !m.isSent)
        .map(m => ({ ...m, category: 'received' }));

      const sentCategorized = sentMessages.map(m => ({ ...m, category: 'sent' }));

      // Merge into lifelog
      const lifelogMessages = [...sentCategorized, ...todaysReceived];
      const updatedLifelog = this.#mergeByDate(existingDateKeyed, lifelogMessages);

      // Save lifelog
      await this.#lifelogStore.save(username, 'gmail', updatedLifelog);

      // Save current inbox state
      if (this.#currentStore) {
        await this.#currentStore.save(username, {
          lastUpdated: new Date().toISOString(),
          unreadCount: inboxMessages.filter(m => m.isUnread).length,
          totalCount: inboxMessages.length,
          messages: inboxMessages,
        });
      }

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('gmail.harvest.complete', {
        username,
        inbox: inboxMessages.length,
        sent: sentMessages.length,
        todaysReceived: todaysReceived.length,
      });

      return {
        inbox: inboxMessages.length,
        sent: sentMessages.length,
        todaysReceived: todaysReceived.length,
        status: 'success',
      };

    } catch (error) {
      const statusCode = error.response?.status || error.code;

      if (statusCode === 429 || statusCode === 401 || statusCode === 403) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('gmail.harvest.error', {
        username,
        error: error.message,
        statusCode,
        circuitState: this.#circuitBreaker.getStatus().state,
      });

      throw error;
    }
  }

  getStatus() {
    return this.#circuitBreaker.getStatus();
  }

  /**
   * Create authenticated Gmail client
   * @private
   */
  async #createGmailClient(username) {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    const auth = this.#configService?.getUserAuth?.('google', username) || {};
    const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

    if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
      throw new Error('Gmail credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(
      GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET,
      GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    return google.gmail({ version: 'v1', auth: oAuth2Client });
  }

  /**
   * Fetch inbox messages
   * @private
   */
  async #fetchInbox(gmail, maxResults) {
    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:inbox',
      maxResults,
    });

    const messages = await Promise.all(
      (data.messages || []).map(async msg => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        return this.#formatMessage(detail.data);
      })
    );

    return messages;
  }

  /**
   * Fetch sent messages
   * @private
   */
  async #fetchSent(gmail, maxResults) {
    const afterDate = this.#getDateDaysAgo(7);

    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: `is:sent after:${afterDate}`,
      maxResults,
    });

    const messages = await Promise.all(
      (data.messages || []).map(async msg => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Date'],
        });
        return this.#formatMessage(detail.data);
      })
    );

    return messages;
  }

  /**
   * Format a Gmail message
   * @private
   */
  #formatMessage(data) {
    const headers = data.payload?.headers || [];
    const internalDate = data.internalDate
      ? new Date(parseInt(data.internalDate))
      : null;

    const getHeader = name => headers.find(h => h.name === name)?.value || '';

    return {
      id: data.id,
      threadId: data.threadId,
      date: internalDate ? internalDate.toISOString().split('T')[0] : null,
      time: internalDate ? internalDate.toISOString().split('T')[1].slice(0, 5) : null,
      timestamp: internalDate ? internalDate.toISOString() : null,
      subject: this.#sanitize(getHeader('Subject') || 'No Subject'),
      from: this.#sanitize(getHeader('From')),
      to: this.#sanitize(getHeader('To')),
      snippet: this.#sanitize(data.snippet || ''),
      isUnread: (data.labelIds || []).includes('UNREAD'),
      isSent: (data.labelIds || []).includes('SENT'),
      labels: data.labelIds || [],
    };
  }

  /**
   * Merge messages by date
   * @private
   */
  #mergeByDate(existing, newMessages) {
    const merged = { ...existing };

    for (const msg of newMessages) {
      if (!msg.date) continue;
      if (!merged[msg.date]) merged[msg.date] = [];
      if (!merged[msg.date].find(m => m.id === msg.id)) {
        merged[msg.date].push(msg);
      }
    }

    // Sort each day's messages by time
    for (const date of Object.keys(merged)) {
      merged[date].sort((a, b) => (a.time || '').localeCompare(b.time || ''));
    }

    return merged;
  }

  /**
   * Sanitize text
   * @private
   */
  #sanitize(text) {
    if (!text) return '';
    return text.replace(/[\x00-\x1F\x7F]/g, '').trim();
  }

  /**
   * Get date N days ago
   * @private
   */
  #getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0].replace(/-/g, '/');
  }
}

export default GmailHarvester;
