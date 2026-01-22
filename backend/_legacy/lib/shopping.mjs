/**
 * Shopping - Legacy Re-export Shim
 *
 * MIGRATION: This file wraps ShoppingHarvester from the adapter layer.
 * Import from #backend/src/2_adapters/harvester/finance/ShoppingHarvester.mjs instead.
 *
 * This shim maintains the legacy API signature while delegating to the new adapter.
 */

import { google } from 'googleapis';
import { ShoppingHarvester } from '../../src/2_adapters/harvester/finance/ShoppingHarvester.mjs';
import { YamlLifelogStore } from '../../src/2_adapters/harvester/YamlLifelogStore.mjs';
import { configService } from './config/index.mjs';
import { userLoadFile, userSaveFile } from './io.mjs';
import { getAIGateway } from './ai/index.mjs';
import { createLogger } from './logging/logger.js';

const defaultLogger = createLogger({
  source: 'backend',
  app: 'shopping'
});

// Lazy-initialized singleton
let harvesterInstance = null;

/**
 * Create Gmail API client for a user
 * @param {string} username - Target username
 * @returns {Promise<object>} Gmail API client
 */
async function createGmailClient(username) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  const auth = configService.getUserAuth('google', username) || {};
  const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

  if (!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
    throw new Error('Gmail credentials not found. Configure Google OAuth.');
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
 * Get or create the ShoppingHarvester singleton
 * @param {object} [logger] - Logger instance
 * @returns {ShoppingHarvester}
 */
function getHarvester(logger = defaultLogger) {
  if (!harvesterInstance) {
    // Create lifelog store wrapping legacy io functions
    const lifelogStore = new YamlLifelogStore({
      io: { userLoadFile, userSaveFile },
      logger
    });

    // Create harvester with dependencies
    harvesterInstance = new ShoppingHarvester({
      gmailClientFactory: createGmailClient,
      aiGateway: getAIGateway(),
      lifelogStore,
      configService,
      logger
    });
  }
  return harvesterInstance;
}

/**
 * Main harvest function - fetch and process shopping receipts
 *
 * Legacy signature: (logger, guidId, req)
 * New adapter signature: harvest(username, options)
 *
 * @param {object} logger - Logger instance
 * @param {string} guidId - Request ID for tracing
 * @param {object} req - Express request object
 * @returns {Promise<object>} Harvest result
 */
export default async function harvestShopping(logger, guidId, req) {
  const log = logger || defaultLogger;

  // Resolve target user from request or default
  const username = req?.targetUsername || configService.getDefaultUsername();

  log.info('shopping.harvest.start', { jobId: guidId, username });

  // Map legacy query params to new options format
  const options = {
    full: req?.query?.full === 'true',
    days: 7, // default lookback
    retailer: req?.query?.retailer
  };

  // Handle explicit since param
  if (req?.query?.since) {
    // Calculate days from since date
    const sinceDate = new Date(req.query.since);
    const now = new Date();
    const diffMs = now - sinceDate;
    options.days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  try {
    const harvester = getHarvester(log);
    const result = await harvester.harvest(username, options);

    // Transform adapter result to legacy format
    return {
      success: result.status === 'success',
      receipts: result.stats || { processed: 0, new: 0, skipped: 0, errors: 0 },
      lastSync: new Date().toISOString()
    };
  } catch (error) {
    log.error('shopping.harvest.error', {
      jobId: guidId,
      username,
      error: error.message
    });
    throw error;
  }
}

// Note: Utility functions (loadShoppingConfig, buildReceiptQuery, parseEmailContent,
// identifyRetailer, extractReceiptData, generateReceiptId, mergeReceipts, formatLocalTimestamp)
// are now private methods in ShoppingHarvester. They are not exported from this shim
// because they are not imported anywhere else in the codebase.
