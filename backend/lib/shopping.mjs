/**
 * Shopping Receipt Harvester
 * 
 * Scans Gmail for shopping receipts, extracts itemized data using AI,
 * and saves structured YAML for budget analysis.
 * 
 * @module backend/lib/shopping
 */

import { google } from 'googleapis';
import moment from 'moment-timezone';
import {
    userSaveFile,
    userLoadFile,
    getDefaultUsername,
    householdLoadFile
} from './io.mjs';
import { configService } from './config/index.mjs';
import { createLogger } from './logging/logger.js';
import { getAIGateway, systemMessage, userMessage } from './ai/index.mjs';

const defaultLogger = createLogger({
    source: 'backend',
    app: 'shopping'
});

/**
 * Default shopping config if not specified in household
 */
const DEFAULT_CONFIG = {
    enabled: true,
    timezone: 'America/Chicago',
    retailers: [
        {
            id: 'amazon',
            name: 'Amazon',
            senders: [
                'shipment-tracking@amazon.com',
                'auto-confirm@amazon.com',
                'digital-no-reply@amazon.com',
                'order-update@amazon.com'
            ],
            keywords: ['order', 'shipment', 'delivered', 'confirmation']
        },
        {
            id: 'target',
            name: 'Target',
            senders: [
                'orders@target.com',
                'receipts@target.com',
                'target@em.target.com',
                'noreply@target.com'
            ],
            keywords: ['order', 'receipt', 'shipped', 'ready for pickup']
        },
        {
            id: 'walmart',
            name: 'Walmart',
            senders: [
                'help@walmart.com',
                'orders@walmart.com',
                'noreply@walmart.com',
                'walmart@order.walmart.com'
            ],
            keywords: ['order', 'shipped', 'delivered', 'confirmation']
        },
        {
            id: 'costco',
            name: 'Costco',
            senders: [
                'costco.com',
                'noreply@costco.com',
                'orders@costco.com',
                'warehouse@costco.com'
            ],
            keywords: ['order', 'receipt', 'confirmation']
        },
        {
            id: 'instacart',
            name: 'Instacart',
            senders: [
                'instacart.com',
                'noreply@instacart.com',
                'receipts@instacart.com'
            ],
            keywords: ['receipt', 'delivery', 'order']
        },
        {
            id: 'heb',
            name: 'H-E-B',
            senders: [
                'noreply@heb.com',
                'curbside@heb.com',
                'orders@heb.com',
                'heb@email.heb.com'
            ],
            keywords: ['order', 'pickup', 'curbside', 'receipt']
        },
        {
            id: 'bestbuy',
            name: 'Best Buy',
            senders: [
                'bestbuy.com',
                'bestbuyinfo@emailinfo.bestbuy.com',
                'noreply@bestbuy.com'
            ],
            keywords: ['order', 'shipped', 'receipt', 'confirmation']
        },
        {
            id: 'homedepot',
            name: 'Home Depot',
            senders: [
                'homedepot.com',
                'noreply@homedepot.com',
                'orders@homedepot.com'
            ],
            keywords: ['order', 'shipped', 'receipt', 'confirmation']
        },
        {
            id: 'apple',
            name: 'Apple',
            senders: [
                'no_reply@email.apple.com',
                'noreply@apple.com',
                'orders@apple.com'
            ],
            keywords: ['order', 'receipt', 'confirmation', 'invoice']
        }
    ]
};

/**
 * Load shopping config for user's household
 * @param {string} username - Target username
 * @returns {object} Shopping config with retailers and timezone
 */
export function loadShoppingConfig(username) {
    const householdId = configService.getUserHouseholdId(username);
    const config = householdLoadFile(householdId, 'config');
    
    // Use household config if available, otherwise default
    const shoppingConfig = config?.shopping || DEFAULT_CONFIG;
    
    if (!shoppingConfig.enabled) {
        throw new Error('Shopping harvester not enabled for this household');
    }
    
    return {
        timezone: shoppingConfig.timezone || 'America/Chicago',
        retailers: shoppingConfig.retailers || DEFAULT_CONFIG.retailers
    };
}

/**
 * Build Gmail search query for receipts from household config
 * @param {object} options
 * @param {object[]} options.retailers - Retailer configs from household YAML
 * @param {Date|string} [options.since] - Only emails after this date
 * @param {string} [options.timezone] - User's timezone for date formatting
 * @param {string} [options.retailerFilter] - Filter to specific retailer ID
 * @returns {string} Gmail search query
 */
export function buildReceiptQuery(options) {
    const { retailers, since, timezone, retailerFilter } = options;
    
    // Filter retailers if specific one requested
    const activeRetailers = retailerFilter 
        ? retailers.filter(r => r.id === retailerFilter)
        : retailers;
    
    if (activeRetailers.length === 0) {
        throw new Error(`No retailers configured${retailerFilter ? ` matching '${retailerFilter}'` : ''}`);
    }
    
    // Build query from household config
    const retailerQueries = activeRetailers.map(r => {
        const senderQuery = r.senders.map(s => `from:${s}`).join(' OR ');
        const keywordQuery = r.keywords?.length 
            ? `(${r.keywords.map(k => `subject:${k}`).join(' OR ')})` 
            : '';
        return `(${senderQuery})${keywordQuery ? ` ${keywordQuery}` : ''}`;
    });
    
    let query = `(${retailerQueries.join(' OR ')})`;
    
    if (since) {
        // Format date in local timezone for Gmail query
        const localDate = moment(since).tz(timezone || 'America/Chicago').format('YYYY/MM/DD');
        query += ` after:${localDate}`;
    }
    
    return query;
}

/**
 * Extract header value from Gmail message
 * @param {object} message - Gmail message object
 * @param {string} headerName - Header to extract
 * @returns {string|null}
 */
function extractHeader(message, headerName) {
    const headers = message.payload?.headers || [];
    const header = headers.find(h => h.name.toLowerCase() === headerName.toLowerCase());
    return header?.value || null;
}

/**
 * Extract email body as plain text
 * @param {object} message - Gmail message object
 * @returns {string}
 */
function extractBody(message) {
    const payload = message.payload;
    
    // Try to get plain text part first
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf8');
    }
    
    // Check parts for multipart messages
    if (payload.parts) {
        // Prefer plain text
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
            return Buffer.from(textPart.body.data, 'base64').toString('utf8');
        }
        
        // Fall back to HTML (strip tags)
        const htmlPart = payload.parts.find(p => p.mimeType === 'text/html');
        if (htmlPart?.body?.data) {
            const html = Buffer.from(htmlPart.body.data, 'base64').toString('utf8');
            // Basic HTML to text conversion
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
        
        // Check nested parts (for multipart/alternative inside multipart/mixed)
        for (const part of payload.parts) {
            if (part.parts) {
                const nestedText = part.parts.find(p => p.mimeType === 'text/plain');
                if (nestedText?.body?.data) {
                    return Buffer.from(nestedText.body.data, 'base64').toString('utf8');
                }
            }
        }
    }
    
    // Last resort: use snippet
    return message.snippet || '';
}

/**
 * Parse email content suitable for AI processing
 * @param {object} message - Gmail message object
 * @returns {object} Parsed email data
 */
export function parseEmailContent(message) {
    return {
        id: message.id,
        threadId: message.threadId,
        subject: extractHeader(message, 'Subject'),
        from: extractHeader(message, 'From'),
        date: extractHeader(message, 'Date'),
        body: extractBody(message),
        snippet: message.snippet
    };
}

/**
 * Identify which retailer sent an email
 * @param {object} email - Parsed email content
 * @param {object[]} retailers - Retailer configs
 * @returns {object|null} Matching retailer config or null
 */
export function identifyRetailer(email, retailers) {
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
 * Use AI to extract structured receipt data
 * @param {object} email - Parsed email content
 * @param {string} retailerName - Retailer name for context
 * @param {object} [logger] - Logger instance
 * @returns {Promise<object>} Structured receipt data
 */
export async function extractReceiptData(email, retailerName, logger = defaultLogger) {
    const ai = getAIGateway();
    
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
- Extract time if present in the receipt
- For items without individual prices, estimate from total if possible
- Clean up item names (remove SKUs, extra codes)
- If no items can be extracted, return empty items array`;

    const messages = [
        systemMessage(systemPrompt),
        userMessage(`Extract receipt data from this ${retailerName} email:\n\nSubject: ${email.subject}\n\n${email.body}`)
    ];

    logger.debug('shopping.ai.extract', { emailId: email.id, retailer: retailerName });
    
    const result = await ai.chatWithJson(messages, { 
        model: 'gpt-4o-mini',
        maxTokens: 2000,
        temperature: 0.1
    });
    
    logger.debug('shopping.ai.result', { 
        emailId: email.id, 
        itemCount: result?.items?.length || 0,
        total: result?.total 
    });
    
    return result;
}

/**
 * Generate unique receipt ID
 * @param {string} source - Retailer ID
 * @param {string} date - Receipt date (YYYY-MM-DD)
 * @param {string} orderId - Order ID or email ID
 * @returns {string} Unique identifier
 */
export function generateReceiptId(source, date, orderId) {
    const parts = [source, date, orderId].filter(Boolean);
    return parts.join('_').replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

/**
 * Merge new receipts with existing data
 * @param {object[]} existing - Existing receipts from file
 * @param {object[]} incoming - Newly parsed receipts
 * @returns {object[]} Merged & deduped receipts
 */
export function mergeReceipts(existing, incoming) {
    const existingIds = new Set(existing.map(r => r.id));
    const newReceipts = incoming.filter(r => !existingIds.has(r.id));
    
    return [...existing, ...newReceipts].sort((a, b) => 
        new Date(b.date || 0) - new Date(a.date || 0)
    );
}

/**
 * Format timestamp in user's local timezone
 * @param {Date|string} date - Date to format
 * @param {string} timezone - IANA timezone string
 * @returns {string} ISO 8601 with timezone offset
 */
export function formatLocalTimestamp(date, timezone) {
    // Handle RFC 2822 format from Gmail headers (e.g., "Mon, 30 Dec 2025 10:00:00 -0600")
    const parsed = moment.tz(date, [
        moment.ISO_8601,
        'ddd, DD MMM YYYY HH:mm:ss ZZ',  // RFC 2822
        'YYYY-MM-DDTHH:mm:ss',
        'YYYY-MM-DD'
    ], timezone);
    
    return parsed.isValid() ? parsed.format() : moment().tz(timezone).format();
}

/**
 * Main harvest function - fetch and process shopping receipts
 * @param {object} logger - Logger instance
 * @param {string} guidId - Request ID for tracing
 * @param {object} req - Express request object
 * @returns {Promise<object>} Harvest result
 */
export default async function harvestShopping(logger, guidId, req) {
    const log = logger || defaultLogger;
    
    // Resolve target user
    const username = req?.targetUsername || getDefaultUsername();
    log.info('shopping.harvest.start', { jobId: guidId, username });
    
    // Load config
    let config;
    try {
        config = loadShoppingConfig(username);
    } catch (error) {
        log.warn('shopping.config.fallback', { 
            username, 
            error: error.message,
            using: 'default config'
        });
        config = {
            timezone: DEFAULT_CONFIG.timezone,
            retailers: DEFAULT_CONFIG.retailers
        };
    }
    
    // Get Gmail credentials
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    const auth = configService.getUserAuth('google', username) || {};
    const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;
    
    if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
        throw new Error('Gmail credentials not found. Configure Google OAuth.');
    }
    
    // Initialize Gmail client
    const oAuth2Client = new google.auth.OAuth2(
        GOOGLE_CLIENT_ID, 
        GOOGLE_CLIENT_SECRET, 
        GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    
    // Load existing data
    const existingData = userLoadFile(username, 'shopping') || { meta: {}, receipts: [] };
    const existingReceipts = existingData.receipts || [];
    
    // Load false positive history (emails with no receipt data)
    const falsePositives = new Set(existingData.meta?.false_positives || []);
    
    // Determine date range
    const fullSync = req?.query?.full === 'true';
    const retailerFilter = req?.query?.retailer;
    
    // Date range logic:
    // 1. Explicit ?since= query param (highest priority)
    // 2. Full sync (?full=true) - no date filter
    // 3. Default: 7 days back (for daily cron to catch stragglers and ensure dedupe)
    let since = req?.query?.since;
    if (!since && !fullSync) {
        // Default to 7 days back for daily runs
        const sevenDaysAgo = moment().subtract(7, 'days').format('YYYY-MM-DD');
        since = sevenDaysAgo;
        log.info('shopping.default-lookback', { since, reason: 'default_7_days' });
    }
    
    // Build search query
    const query = buildReceiptQuery({
        retailers: config.retailers,
        since,
        timezone: config.timezone,
        retailerFilter
    });
    
    log.info('shopping.gmail.search', { query, since, retailerFilter });
    
    // Search Gmail
    const listResponse = await gmail.users.messages.list({ 
        userId: 'me', 
        q: query,
        maxResults: 100
    });
    
    const messageIds = listResponse.data.messages || [];
    log.info('shopping.gmail.found', { count: messageIds.length });
    
    if (messageIds.length === 0) {
        return {
            success: true,
            receipts: { processed: 0, new: 0, skipped: 0, errors: 0 },
            lastSync: formatLocalTimestamp(new Date(), config.timezone)
        };
    }
    
    // Process messages
    const results = {
        processed: 0,
        new: 0,
        skipped: 0,
        errors: 0
    };
    
    const newReceipts = [];
    
    for (const { id: messageId } of messageIds) {
        try {
            // Fetch full message
            const { data: message } = await gmail.users.messages.get({ 
                userId: 'me', 
                id: messageId,
                format: 'full'
            });
            
            // Parse email
            const email = parseEmailContent(message);
            
            // Identify retailer
            const retailer = identifyRetailer(email, config.retailers);
            if (!retailer) {
                log.debug('shopping.retailer.unknown', { emailId: messageId, from: email.from });
                results.skipped++;
                continue;
            }
            
            // Check if already processed (check email_id in existing receipts)
            if (existingReceipts.some(r => r.email_id === messageId)) {
                log.debug('shopping.receipt.duplicate', { emailId: messageId });
                results.skipped++;
                continue;
            }
            
            // Check if this is a known false positive (email with no receipt)
            if (falsePositives.has(messageId)) {
                log.debug('shopping.false_positive.skip', { emailId: messageId });
                results.skipped++;
                continue;
            }
            
            // Extract receipt data via AI
            const receiptData = await extractReceiptData(email, retailer.name, log);
            
            if (!receiptData || (!receiptData.total && (!receiptData.items || receiptData.items.length === 0))) {
                log.warn('shopping.extraction.empty', { emailId: messageId, retailer: retailer.id });
                // Add to false positives to avoid re-processing
                falsePositives.add(messageId);
                results.errors++;
                continue;
            }
            
            // Build receipt record
            const receiptDate = receiptData.date || moment(email.date).format('YYYY-MM-DD');
            const receiptId = generateReceiptId(
                retailer.id, 
                receiptDate, 
                receiptData.order_id || messageId
            );
            
            const receipt = {
                id: receiptId,
                source: retailer.id,
                email_id: messageId,
                date: receiptDate,
                datetime: formatLocalTimestamp(
                    receiptData.time 
                        ? `${receiptDate}T${receiptData.time}` 
                        : email.date,
                    config.timezone
                ),
                merchant: receiptData.merchant || retailer.name,
                order_id: receiptData.order_id || null,
                subtotal: receiptData.subtotal,
                tax: receiptData.tax,
                shipping: receiptData.shipping,
                total: receiptData.total,
                currency: receiptData.currency || 'USD',
                items: receiptData.items || []
            };
            
            newReceipts.push(receipt);
            results.new++;
            results.processed++;
            
            log.info('shopping.receipt.processed', { 
                id: receiptId, 
                retailer: retailer.id,
                total: receipt.total,
                itemCount: receipt.items.length
            });
            
            // INCREMENTAL SAVE after each receipt
            const currentMerged = mergeReceipts(existingReceipts, newReceipts);
            const currentTotalItems = currentMerged.reduce((sum, r) => sum + (r.items?.length || 0), 0);
            
            const incrementalData = {
                meta: {
                    lastSync: formatLocalTimestamp(new Date(), config.timezone),
                    timezone: config.timezone,
                    totalReceipts: currentMerged.length,
                    totalItems: currentTotalItems,
                    false_positives: Array.from(falsePositives)
                },
                receipts: currentMerged
            };
            
            userSaveFile(username, 'shopping', incrementalData);
            
        } catch (error) {
            log.error('shopping.message.error', { 
                emailId: messageId, 
                error: error.message 
            });
            results.errors++;
        }
    }
    
    // Final merge and save (in case no new receipts, still update lastSync)
    const mergedReceipts = mergeReceipts(existingReceipts, newReceipts);
    const totalItems = mergedReceipts.reduce((sum, r) => sum + (r.items?.length || 0), 0);
    
    const outputData = {
        meta: {
            lastSync: formatLocalTimestamp(new Date(), config.timezone),
            timezone: config.timezone,
            totalReceipts: mergedReceipts.length,
            totalItems,
            false_positives: Array.from(falsePositives)
        },
        receipts: mergedReceipts
    };
    
    userSaveFile(username, 'shopping', outputData);
    
    log.info('shopping.harvest.complete', { 
        jobId: guidId,
        ...results,
        totalReceipts: mergedReceipts.length,
        falsePositives: falsePositives.size
    });
    
    return {
        success: true,
        receipts: results,
        lastSync: outputData.meta.lastSync
    };
}
