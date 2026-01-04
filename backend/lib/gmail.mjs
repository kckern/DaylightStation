import { google } from 'googleapis';
import { saveFile, sanitize, userSaveFile, userLoadFile, userSaveCurrent, getDefaultUsername } from './io.mjs';
import { configService } from './config/ConfigService.mjs';
import { createLogger } from './logging/logger.js';
import moment from 'moment';

const defaultGmailLogger = createLogger({
    source: 'backend',
    app: 'gmail'
});

/**
 * Format a Gmail message into a standardized structure
 * @param {Object} data - Raw Gmail API message data
 * @returns {Object} Formatted message
 */
const formatMessage = (data) => {
    const headers = data.payload?.headers || [];
    const internalDate = data.internalDate ? new Date(parseInt(data.internalDate)) : null;
    
    return {
        id: data.id,
        date: internalDate ? moment(internalDate).format('YYYY-MM-DD') : moment().format('YYYY-MM-DD'),
        time: internalDate ? moment(internalDate).format('HH:mm') : '00:00',
        subject: sanitize(headers.find(h => h.name === 'Subject')?.value || 'No Subject'),
        from: sanitize(headers.find(h => h.name === 'From')?.value || 'Unknown'),
        to: sanitize(headers.find(h => h.name === 'To')?.value || 'Unknown'),
        snippet: sanitize(data.snippet || ''),
        isUnread: Array.isArray(data.labelIds) && data.labelIds.includes('UNREAD'),
        isSent: Array.isArray(data.labelIds) && data.labelIds.includes('SENT')
    };
};

/**
 * Merge messages by date into date-keyed lifelog structure
 * @param {Object} existing - Existing date-keyed lifelog data
 * @param {Array} newMessages - New messages to merge
 * @returns {Object} Merged date-keyed data
 */
const mergeByDate = (existing, newMessages) => {
    const merged = { ...existing };
    for (const msg of newMessages) {
        if (!merged[msg.date]) merged[msg.date] = [];
        if (!merged[msg.date].find(m => m.id === msg.id)) {
            merged[msg.date].push(msg);
        }
    }
    // Sort each day's messages by time
    for (const date of Object.keys(merged)) {
        merged[date].sort((a, b) => a.time.localeCompare(b.time));
    }
    return merged;
};

const listMails = async (logger, job_id, targetUsername = null) => {
    const log = logger || defaultGmailLogger;
    
    // System-level OAuth app credentials (shared across all users)
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    
    // User-level auth (personal refresh token)
    const username = targetUsername || getDefaultUsername();
    log.info('gmail.username', { username, type: typeof username, targetUsername });
    const auth = configService.getUserAuth('google', username) || {};
    const refreshToken = auth.refresh_token || process.env.GOOGLE_REFRESH_TOKEN;

    if(!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI && refreshToken)) {
        throw new Error('Gmail credentials not found');
    }

    const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
    oAuth2Client.setCredentials({ refresh_token: refreshToken });

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const today = moment().format('YYYY-MM-DD');
    
    // === CURRENT DATA: All emails currently in inbox ===
    const { data: inboxData } = await gmail.users.messages.list({ userId: 'me', q: 'is:inbox', maxResults: 100 });
    
    const inboxMessages = await Promise.all((inboxData.messages || []).map(async message => {
        const { data } = await gmail.users.messages.get({ 
            userId: 'me', 
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date']
        });
        
        // Fallback: use labelIds from list response if get() doesn't have them
        const enrichedData = {
            ...data,
            labelIds: data.labelIds || message.labelIds || []
        };
        
        log.debug('gmail.message.labels', { 
            id: data.id,
            labelIds: enrichedData.labelIds,
            hasUnread: enrichedData.labelIds.includes('UNREAD'),
            fromList: message.labelIds,
            fromGet: data.labelIds
        });
        
        return formatMessage(enrichedData);
    }));

    // Save to current/
    userSaveCurrent(username, 'gmail', {
        lastUpdated: new Date().toISOString(),
        unreadCount: inboxMessages.filter(m => m.isUnread).length,
        totalCount: inboxMessages.length,
        messages: inboxMessages
    });
    
    // === LIFELOG DATA (Phase 2: date-keyed structure) ===
    // 1. All sent emails (last 7 days for incremental harvest)
    const weekAgo = moment().subtract(7, 'days').format('YYYY/MM/DD');
    const sentQuery = `is:sent after:${weekAgo}`;
    const { data: sentData } = await gmail.users.messages.list({
        userId: 'me',
        q: sentQuery,
        maxResults: 200
    });
    
    const sentMessages = await Promise.all((sentData.messages || []).map(async message => {
        const { data } = await gmail.users.messages.get({ userId: 'me', id: message.id });
        return { ...formatMessage(data), category: 'sent' };
    }));
    
    // 2. Inbox emails received TODAY (still in inbox = deemed important)
    const todaysInboxMessages = inboxMessages
        .filter(m => m.date === today && !m.isSent)
        .map(m => ({ ...m, category: 'received' }));
    
    // Combine and merge into date-keyed lifelog
    const lifelogMessages = [...sentMessages, ...todaysInboxMessages];
    const existingLifelog = userLoadFile(username, 'gmail') || {};
    
    log.info('gmail.lifelog.merge', {
        existingIsArray: Array.isArray(existingLifelog),
        existingKeys: Array.isArray(existingLifelog) ? `array[${existingLifelog.length}]` : Object.keys(existingLifelog).slice(0, 5),
        newMessagesCount: lifelogMessages.length
    });
    
    // Handle migration: if existing data is an array (old format), start fresh
    const existingDateKeyed = Array.isArray(existingLifelog) ? {} : existingLifelog;
    const updatedLifelog = mergeByDate(existingDateKeyed, lifelogMessages);
    
    log.info('gmail.lifelog.saving', {
        updatedIsArray: Array.isArray(updatedLifelog),
        updatedKeys: Object.keys(updatedLifelog).slice(0, 5),
        updatedType: typeof updatedLifelog
    });
    
    userSaveFile(username, 'gmail', updatedLifelog);
    
    log.info('harvest.gmail.complete', { 
        jobId: job_id, 
        current: inboxMessages.length,
        lifelog: { sent: sentMessages.length, received: todaysInboxMessages.length }
    });
    
    return { 
        current: inboxMessages.length, 
        lifelog: { sent: sentMessages.length, received: todaysInboxMessages.length }
    };
}

export default listMails
