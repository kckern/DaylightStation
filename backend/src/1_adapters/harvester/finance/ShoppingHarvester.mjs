/**
 * ShoppingHarvester
 *
 * Harvests personal purchase history by scanning Gmail for shopping receipts
 * and extracting structured data using AI.
 * Implements IHarvester interface with circuit breaker resilience.
 *
 * Features:
 * - Gmail receipt scanning from configurable retailers
 * - AI-powered item extraction (GPT-4o-mini)
 * - Incremental sync with deduplication
 * - False positive tracking to avoid reprocessing
 *
 * @module harvester/finance/ShoppingHarvester
 */

import moment from 'moment-timezone';
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';
import { CircuitBreaker } from '../CircuitBreaker.mjs';
import { configService } from '#system/config/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

/**
 * Default retailer configurations for receipt scanning
 */
const DEFAULT_RETAILERS = [
  {
    id: 'amazon',
    name: 'Amazon',
    senders: ['shipment-tracking@amazon.com', 'auto-confirm@amazon.com', 'digital-no-reply@amazon.com'],
    keywords: ['order', 'shipment', 'delivered', 'confirmation'],
  },
  {
    id: 'target',
    name: 'Target',
    senders: ['orders@target.com', 'receipts@target.com', 'target@em.target.com'],
    keywords: ['order', 'receipt', 'shipped'],
  },
  {
    id: 'walmart',
    name: 'Walmart',
    senders: ['help@walmart.com', 'orders@walmart.com', 'walmart@order.walmart.com'],
    keywords: ['order', 'shipped', 'delivered'],
  },
  {
    id: 'costco',
    name: 'Costco',
    senders: ['costco.com', 'noreply@costco.com', 'orders@costco.com'],
    keywords: ['order', 'receipt', 'confirmation'],
  },
  {
    id: 'instacart',
    name: 'Instacart',
    senders: ['instacart.com', 'noreply@instacart.com', 'receipts@instacart.com'],
    keywords: ['receipt', 'delivery', 'order'],
  },
  {
    id: 'heb',
    name: 'H-E-B',
    domains: ['heb.com', 'hebgrocery.com'],
    senders: ['heb.com', 'noreply@heb.com', 'orders@heb.com'],
    keywords: ['order', 'receipt', 'delivery'],
  },
  {
    id: 'bestbuy',
    name: 'Best Buy',
    domains: ['bestbuy.com'],
    senders: ['bestbuy.com', 'noreply@bestbuy.com', 'orders@bestbuy.com'],
    keywords: ['order', 'receipt', 'confirmation'],
  },
  {
    id: 'homedepot',
    name: 'Home Depot',
    domains: ['homedepot.com'],
    senders: ['homedepot.com', 'noreply@homedepot.com', 'orders@homedepot.com'],
    keywords: ['order', 'receipt', 'confirmation'],
  },
  {
    id: 'apple',
    name: 'Apple',
    domains: ['apple.com'],
    senders: ['apple.com', 'noreply@apple.com', 'no_reply@email.apple.com'],
    keywords: ['order', 'receipt', 'invoice'],
  },
];

const DEFAULT_DAYS_BACK = 7;

/**
 * Shopping receipt harvester
 * @implements {IHarvester}
 */
export class ShoppingHarvester extends IHarvester {
  #gmailClientFactory;
  #aiGateway;
  #lifelogStore;
  #configService;
  #circuitBreaker;
  #timezone;
  #logger;

  /**
   * @param {Object} config
   * @param {Function} config.gmailClientFactory - Factory to create Gmail client (username) => gmail
   * @param {Object} config.aiGateway - AI gateway for receipt extraction
   * @param {Object} config.lifelogStore - Store for shopping data
   * @param {Object} config.configService - ConfigService for credentials and config
   * @param {string} [config.timezone] - Timezone for date parsing
   * @param {Object} [config.logger] - Logger instance
   */
  constructor({
    gmailClientFactory,
    aiGateway,
    lifelogStore,
    configService,
    timezone = configService?.isReady?.() ? configService.getTimezone() : 'America/Los_Angeles',
    logger = console,
  }) {
    super();

    if (!gmailClientFactory) {
      throw new InfrastructureError('ShoppingHarvester requires gmailClientFactory', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'gmailClientFactory'
      });
    }
    if (!aiGateway) {
      throw new InfrastructureError('ShoppingHarvester requires aiGateway', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'aiGateway'
      });
    }
    if (!lifelogStore) {
      throw new InfrastructureError('ShoppingHarvester requires lifelogStore', {
        code: 'MISSING_DEPENDENCY',
        dependency: 'lifelogStore'
      });
    }

    this.#gmailClientFactory = gmailClientFactory;
    this.#aiGateway = aiGateway;
    this.#lifelogStore = lifelogStore;
    this.#configService = configService;
    this.#timezone = timezone;
    this.#logger = logger;

    this.#circuitBreaker = new CircuitBreaker({
      maxFailures: 3,
      baseCooldownMs: 10 * 60 * 1000, // 10 mins
      maxCooldownMs: 2 * 60 * 60 * 1000, // 2 hours
      logger: logger,
    });
  }

  get serviceId() {
    return 'shopping';
  }

  get category() {
    return HarvesterCategory.FINANCE;
  }

  /**
   * Harvest shopping receipts from Gmail
   *
   * @param {string} username - Target user
   * @param {Object} [options] - Harvest options
   * @param {boolean} [options.full=false] - Full sync vs incremental
   * @param {number} [options.days=7] - Days back for incremental sync
   * @param {string} [options.retailer] - Filter to specific retailer ID
   * @returns {Promise<{ count: number, stats: Object, status: string }>}
   */
  async harvest(username, options = {}) {
    const { full = false, days = DEFAULT_DAYS_BACK, retailer: retailerFilter } = options;

    // Check circuit breaker
    if (this.#circuitBreaker.isOpen()) {
      const cooldown = this.#circuitBreaker.getCooldownStatus();
      this.#logger.debug?.('shopping.harvest.skipped', {
        username,
        reason: 'Circuit breaker active',
        remainingMins: cooldown?.remainingMins,
      });
      return {
        count: 0,
        stats: {},
        status: 'skipped',
        reason: 'cooldown',
        remainingMins: cooldown?.remainingMins,
      };
    }

    try {
      this.#logger.info?.('shopping.harvest.start', {
        username,
        mode: full ? 'full' : 'incremental',
        days: full ? 'all' : days,
        retailerFilter,
      });

      // Load config
      const config = this.#loadConfig(username);
      const { retailers, timezone } = config;

      // Get Gmail client
      const gmail = await this.#gmailClientFactory(username);

      // Load existing data
      let existingData;
      try {
        existingData = await this.#lifelogStore.load(username, 'shopping') || { meta: {}, receipts: [] };
      } catch {
        existingData = { meta: {}, receipts: [] };
      }
      const existingReceipts = existingData.receipts || [];
      const falsePositives = new Set(existingData.meta?.false_positives || []);

      // Build search query
      const since = full ? null : moment().subtract(days, 'days').format('YYYY-MM-DD');
      const query = this.#buildReceiptQuery({ retailers, since, timezone, retailerFilter });

      this.#logger.info?.('shopping.gmail.search', { query, since, retailerFilter });

      // Search Gmail
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: 100,
      });

      const messageIds = listResponse.data.messages || [];
      this.#logger.info?.('shopping.gmail.found', { count: messageIds.length });

      if (messageIds.length === 0) {
        return {
          count: existingReceipts.length,
          stats: { processed: 0, new: 0, skipped: 0, errors: 0 },
          status: 'success',
        };
      }

      // Process messages
      const results = { processed: 0, new: 0, skipped: 0, errors: 0 };
      const newReceipts = [];

      for (const { id: messageId } of messageIds) {
        try {
          // Skip if already processed
          if (existingReceipts.some(r => r.email_id === messageId)) {
            results.skipped++;
            continue;
          }

          // Skip known false positives
          if (falsePositives.has(messageId)) {
            results.skipped++;
            continue;
          }

          // Fetch full message
          const { data: message } = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
            format: 'full',
          });

          // Parse email
          const email = this.#parseEmailContent(message);

          // Identify retailer
          const retailerConfig = this.#identifyRetailer(email, retailers);
          if (!retailerConfig) {
            results.skipped++;
            continue;
          }

          // Extract receipt data via AI
          const receiptData = await this.#extractReceiptData(email, retailerConfig.name);

          if (!receiptData || (!receiptData.total && (!receiptData.items || receiptData.items.length === 0))) {
            this.#logger.warn?.('shopping.extraction.empty', { emailId: messageId, retailer: retailerConfig.id });
            falsePositives.add(messageId);
            results.errors++;
            continue;
          }

          // Build receipt record
          const receiptDate = receiptData.date || moment(email.date).format('YYYY-MM-DD');
          const receiptId = this.#generateReceiptId(retailerConfig.id, receiptDate, receiptData.order_id || messageId);

          const receipt = {
            id: receiptId,
            source: retailerConfig.id,
            email_id: messageId,
            date: receiptDate,
            datetime: this.#formatLocalTimestamp(
              receiptData.time ? `${receiptDate}T${receiptData.time}` : email.date,
              timezone
            ),
            merchant: receiptData.merchant || retailerConfig.name,
            order_id: receiptData.order_id || null,
            subtotal: receiptData.subtotal,
            tax: receiptData.tax,
            shipping: receiptData.shipping,
            total: receiptData.total,
            currency: receiptData.currency || 'USD',
            items: receiptData.items || [],
          };

          newReceipts.push(receipt);
          results.new++;
          results.processed++;

          this.#logger.info?.('shopping.receipt.processed', {
            id: receiptId,
            retailer: retailerConfig.id,
            total: receipt.total,
            itemCount: receipt.items.length,
          });

        } catch (error) {
          this.#logger.error?.('shopping.message.error', {
            emailId: messageId,
            error: error.message,
          });
          results.errors++;
        }
      }

      // Merge and save
      const mergedReceipts = this.#mergeReceipts(existingReceipts, newReceipts);
      const totalItems = mergedReceipts.reduce((sum, r) => sum + (r.items?.length || 0), 0);

      const outputData = {
        meta: {
          lastSync: this.#formatLocalTimestamp(new Date(), timezone),
          timezone,
          totalReceipts: mergedReceipts.length,
          totalItems,
          false_positives: Array.from(falsePositives),
        },
        receipts: mergedReceipts,
      };

      await this.#lifelogStore.save(username, 'shopping', outputData);

      // Success - reset circuit breaker
      this.#circuitBreaker.recordSuccess();

      this.#logger.info?.('shopping.harvest.complete', {
        username,
        ...results,
        totalReceipts: mergedReceipts.length,
        falsePositives: falsePositives.size,
      });

      // Get latest date from merged receipts (sorted newest first)
      const latestDate = mergedReceipts[0]?.date || null;

      return {
        count: mergedReceipts.length,
        stats: results,
        status: 'success',
        latestDate,
      };

    } catch (error) {
      const statusCode = error.response?.status;

      if (statusCode === 401 || statusCode === 403 || statusCode === 429) {
        this.#circuitBreaker.recordFailure(error);
      }

      this.#logger.error?.('shopping.harvest.error', {
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
   * Load shopping config for user
   * @private
   */
  #loadConfig(username) {
    try {
      const householdId = this.#configService?.getUserHouseholdId?.(username);
      const config = this.#configService?.getHouseholdConfig?.(householdId);
      const shoppingConfig = config?.shopping;

      if (shoppingConfig?.enabled === false) {
        throw new InfrastructureError('Shopping harvester not enabled for this household', {
          code: 'FEATURE_DISABLED',
          service: 'Shopping',
          household: householdId
        });
      }

      return {
        timezone: shoppingConfig?.timezone || this.#timezone,
        retailers: shoppingConfig?.retailers || DEFAULT_RETAILERS,
      };
    } catch {
      return {
        timezone: this.#timezone,
        retailers: DEFAULT_RETAILERS,
      };
    }
  }

  /**
   * Build Gmail search query for receipts
   * @private
   */
  #buildReceiptQuery({ retailers, since, timezone, retailerFilter }) {
    const activeRetailers = retailerFilter
      ? retailers.filter(r => r.id === retailerFilter)
      : retailers;

    if (activeRetailers.length === 0) {
      throw new InfrastructureError(`No retailers configured${retailerFilter ? ` matching '${retailerFilter}'` : ''}`, {
        code: 'MISSING_CONFIG',
        service: 'Shopping'
      });
    }

    const retailerQueries = activeRetailers.map(r => {
      const senderQuery = r.senders.map(s => `from:${s}`).join(' OR ');
      const keywordQuery = r.keywords?.length
        ? `(${r.keywords.map(k => `subject:${k}`).join(' OR ')})`
        : '';
      return `(${senderQuery})${keywordQuery ? ` ${keywordQuery}` : ''}`;
    });

    let query = `(${retailerQueries.join(' OR ')})`;

    if (since) {
      const localDate = moment(since).tz(timezone).format('YYYY/MM/DD');
      query += ` after:${localDate}`;
    }

    return query;
  }

  /**
   * Parse email content from Gmail message
   * @private
   */
  #parseEmailContent(message) {
    const extractHeader = (name) => {
      const header = message.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase());
      return header?.value || null;
    };

    const extractBody = () => {
      const payload = message.payload;

      if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
      }

      if (payload.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          return Buffer.from(textPart.body.data, 'base64').toString('utf8');
        }

        const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
          const html = Buffer.from(htmlPart.body.data, 'base64').toString('utf8');
          return html
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/\s+/g, ' ')
            .trim();
        }

        for (const part of payload.parts) {
          if (part.parts) {
            const nestedText = part.parts.find(p => p.mimeType === 'text/plain');
            if (nestedText?.body?.data) {
              return Buffer.from(nestedText.body.data, 'base64').toString('utf8');
            }
          }
        }
      }

      return message.snippet || '';
    };

    return {
      id: message.id,
      threadId: message.threadId,
      subject: extractHeader('Subject'),
      from: extractHeader('From'),
      date: extractHeader('Date'),
      body: extractBody(),
      snippet: message.snippet,
    };
  }

  /**
   * Identify retailer from email
   * @private
   */
  #identifyRetailer(email, retailers) {
    const fromLower = (email.from || '').toLowerCase();

    for (const retailer of retailers) {
      for (const sender of retailer.senders) {
        if (fromLower.includes(sender.toLowerCase())) {
          return retailer;
        }
      }
    }

    return null;
  }

  /**
   * Extract receipt data using AI
   * @private
   */
  async #extractReceiptData(email, retailerName) {
    const systemPrompt = `You are a receipt parsing assistant. Extract itemized purchase data from email receipts.

Output JSON schema:
{
  "merchant": "string - Store name",
  "order_id": "string - Order/confirmation number",
  "date": "string - YYYY-MM-DD format",
  "time": "string - HH:mm format (24hr) if available, else null",
  "items": [
    {
      "name": "string - Item name (clean, no extra codes)",
      "quantity": "number - default 1 if not specified",
      "unit_price": "number - Price per unit",
      "total_price": "number - quantity * unit_price"
    }
  ],
  "subtotal": "number or null",
  "tax": "number or null",
  "shipping": "number or null",
  "total": "number - Total amount charged",
  "currency": "string - USD, EUR, etc. (default USD)"
}

Rules:
- If a field is not found, use null
- Prices should be numbers without currency symbols
- Clean up item names (remove SKUs, extra codes)
- If no items can be extracted, return empty items array
- Extract time if present in the receipt`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Extract receipt data from this ${retailerName} email:\n\nSubject: ${email.subject}\n\n${email.body}` },
    ];

    this.#logger.debug?.('shopping.ai.extract', { emailId: email.id, retailer: retailerName });

    const result = await this.#aiGateway.chatWithJson(messages, {
      model: 'gpt-4o-mini',
      maxTokens: 2000,
      temperature: 0.1,
    });

    this.#logger.debug?.('shopping.ai.result', {
      emailId: email.id,
      itemCount: result?.items?.length || 0,
      total: result?.total,
    });

    return result;
  }

  /**
   * Generate unique receipt ID
   * @private
   */
  #generateReceiptId(source, date, orderId) {
    const parts = [source, date, orderId].filter(Boolean);
    return parts.join('_').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
  }

  /**
   * Merge receipts with deduplication
   * @private
   */
  #mergeReceipts(existing, incoming) {
    const existingIds = new Set(existing.map(r => r.id));
    const newReceipts = incoming.filter(r => !existingIds.has(r.id));

    return [...existing, ...newReceipts].sort((a, b) =>
      new Date(b.date || 0) - new Date(a.date || 0)
    );
  }

  /**
   * Format timestamp in local timezone
   * @private
   */
  #formatLocalTimestamp(date, timezone) {
    const parsed = moment.tz(date, [
      moment.ISO_8601,
      'ddd, DD MMM YYYY HH:mm:ss ZZ',
      'YYYY-MM-DDTHH:mm:ss',
      'YYYY-MM-DD',
    ], timezone);

    return parsed.isValid() ? parsed.format() : moment().tz(timezone).format();
  }
}

export default ShoppingHarvester;
