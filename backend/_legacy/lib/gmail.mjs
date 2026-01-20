/**
 * Legacy Gmail Bridge
 *
 * This file now delegates email fetching to the new GmailAdapter architecture
 * while maintaining the lifelog file-saving integration.
 *
 * New implementation: backend/src/2_adapters/messaging/GmailAdapter.mjs
 */

import { google } from 'googleapis';
import { saveFile, sanitize, userSaveFile, userLoadFile, userSaveCurrent, getDefaultUsername } from './io.mjs';
import { configService } from './config/index.mjs';
import { createLogger } from './logging/logger.js';
import moment from 'moment';

// Import new architecture adapter
import { GmailAdapter } from '../../src/2_adapters/messaging/GmailAdapter.mjs';

const defaultGmailLogger = createLogger({
  source: 'backend',
  app: 'gmail'
});

/**
 * Create a Google OAuth2 client for a user
 * @param {string} username - Target username
 * @returns {Promise<Object>} Gmail API client
 */
const createGmailClient = async (username) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  const auth = configService.getUserAuth('google', username) || {};
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
};

/**
 * List and harvest emails for a user
 * Delegates to GmailAdapter for fetching, handles lifelog file saving
 *
 * @param {Object} logger - Logger instance
 * @param {string} job_id - Job identifier for logging
 * @param {string} targetUsername - Target username (optional)
 * @returns {Promise<Object>} Harvest results
 */
const listMails = async (logger, job_id, targetUsername = null) => {
  const log = logger || defaultGmailLogger;
  const username = targetUsername || getDefaultUsername();

  log.info('gmail.username', { username, type: typeof username, targetUsername });

  // Create the Gmail adapter with an auth factory
  const gmailAdapter = new GmailAdapter({
    googleAuth: () => createGmailClient(username),
    logger: log
  });

  // Load existing lifelog data
  const existingLifelog = userLoadFile(username, 'gmail') || {};

  log.info('gmail.lifelog.merge', {
    existingIsArray: Array.isArray(existingLifelog),
    existingKeys: Array.isArray(existingLifelog)
      ? `array[${existingLifelog.length}]`
      : Object.keys(existingLifelog).slice(0, 5),
    newMessagesCount: 'pending'
  });

  // Handle migration: if existing data is an array (old format), start fresh
  const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;

  // Use the new adapter to harvest emails
  const result = await gmailAdapter.harvestEmails(existingDateKeyed);

  // Save current inbox to current/ directory
  userSaveCurrent(username, 'gmail', result.current);

  // Save merged lifelog data
  log.info('gmail.lifelog.saving', {
    updatedIsArray: Array.isArray(result.lifelog),
    updatedKeys: Object.keys(result.lifelog).slice(0, 5),
    updatedType: typeof result.lifelog
  });

  userSaveFile(username, 'gmail', result.lifelog);

  log.info('harvest.gmail.complete', {
    jobId: job_id,
    current: result.stats.inbox,
    lifelog: {
      sent: result.stats.sent,
      received: result.stats.todaysReceived
    }
  });

  return {
    current: result.stats.inbox,
    lifelog: {
      sent: result.stats.sent,
      received: result.stats.todaysReceived
    }
  };
};

export default listMails;

// Re-export the new adapter for direct usage
export { GmailAdapter };
