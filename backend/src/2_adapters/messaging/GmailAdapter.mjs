/**
 * GmailAdapter - Gmail API adapter for email harvesting and notifications
 * Implements INotificationChannel for email sending
 */

import { nowTs24, nowDate } from '../../0_infrastructure/utils/index.mjs';

export class GmailAdapter {
  constructor({ googleAuth, logger }) {
    this.googleAuth = googleAuth; // Function to get authenticated Gmail client
    this.logger = logger || console;

    // Metrics
    this.metrics = {
      startedAt: Date.now(),
      emailsFetched: 0,
      emailsSent: 0,
      errors: 0
    };
  }

  /**
   * Get Gmail API client
   */
  async getClient() {
    if (!this.googleAuth) {
      throw new Error('Google authentication not configured');
    }
    return this.googleAuth();
  }

  // ============ INotificationChannel Implementation ============

  /**
   * Send an email notification
   */
  async send(notification) {
    const gmail = await this.getClient();

    const to = notification.recipient;
    const subject = notification.title || 'Notification';
    const body = notification.body;

    const message = this.createMessage(to, subject, body);

    try {
      await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: message
        }
      });

      this.metrics.emailsSent++;
      this.logger.info?.('gmail.notification.sent', {
        notificationId: notification.id,
        recipient: to
      });
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('gmail.notification.error', { error: error.message });
      throw error;
    }
  }

  // ============ Email Harvesting ============

  /**
   * Fetch inbox messages
   */
  async getInboxMessages(options = {}) {
    const gmail = await this.getClient();
    const maxResults = options.maxResults || 100;

    try {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        q: 'is:inbox',
        maxResults
      });

      const messages = await Promise.all(
        (data.messages || []).map(async msg => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date']
          });
          return this.formatMessage(detail.data);
        })
      );

      this.metrics.emailsFetched += messages.length;
      return messages;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('gmail.inbox.error', { error: error.message });
      throw error;
    }
  }

  /**
   * Fetch sent messages
   */
  async getSentMessages(options = {}) {
    const gmail = await this.getClient();
    const maxResults = options.maxResults || 200;
    const afterDate = options.afterDate || this.getDateDaysAgo(7);

    try {
      const { data } = await gmail.users.messages.list({
        userId: 'me',
        q: `is:sent after:${afterDate}`,
        maxResults
      });

      const messages = await Promise.all(
        (data.messages || []).map(async msg => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date']
          });
          return this.formatMessage(detail.data);
        })
      );

      this.metrics.emailsFetched += messages.length;
      return messages;
    } catch (error) {
      this.metrics.errors++;
      this.logger.error?.('gmail.sent.error', { error: error.message });
      throw error;
    }
  }

  /**
   * Get unread count
   */
  async getUnreadCount() {
    const gmail = await this.getClient();

    const { data } = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread is:inbox',
      maxResults: 1
    });

    return data.resultSizeEstimate || 0;
  }

  /**
   * Mark message as read
   */
  async markAsRead(messageId) {
    const gmail = await this.getClient();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD']
      }
    });
  }

  /**
   * Archive a message
   */
  async archiveMessage(messageId) {
    const gmail = await this.getClient();

    await gmail.users.messages.modify({
      userId: 'me',
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX']
      }
    });
  }

  // ============ Helper Methods ============

  /**
   * Format a Gmail message
   */
  formatMessage(data) {
    const headers = data.payload?.headers || [];
    const internalDate = data.internalDate
      ? new Date(parseInt(data.internalDate))
      : null;

    const getHeader = name => headers.find(h => h.name === name)?.value || '';

    return {
      id: data.id,
      threadId: data.threadId,
      date: internalDate ? internalDate.toISOString().split('T')[0] : null,
      time: internalDate
        ? internalDate.toISOString().split('T')[1].slice(0, 5)
        : null,
      timestamp: internalDate ? internalDate.toISOString() : null,
      subject: this.sanitize(getHeader('Subject') || 'No Subject'),
      from: this.sanitize(getHeader('From')),
      to: this.sanitize(getHeader('To')),
      snippet: this.sanitize(data.snippet || ''),
      isUnread: (data.labelIds || []).includes('UNREAD'),
      isSent: (data.labelIds || []).includes('SENT'),
      labels: data.labelIds || []
    };
  }

  /**
   * Create a raw email message
   */
  createMessage(to, subject, body) {
    const message = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\n');

    return Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Sanitize text (remove problematic characters)
   */
  sanitize(text) {
    if (!text) return '';
    return text
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim();
  }

  /**
   * Get date N days ago in YYYY/MM/DD format
   */
  getDateDaysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0].replace(/-/g, '/');
  }

  /**
   * Merge messages by date into lifelog structure
   */
  mergeByDate(existing, newMessages) {
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
   * Harvest emails for lifelog
   */
  async harvestEmails(existingData = {}) {
    const [inboxMessages, sentMessages] = await Promise.all([
      this.getInboxMessages(),
      this.getSentMessages()
    ]);

    const today = nowDate();

    // Categorize messages
    const todaysInbox = inboxMessages
      .filter(m => m.date === today && !m.isSent)
      .map(m => ({ ...m, category: 'received' }));

    const sent = sentMessages.map(m => ({ ...m, category: 'sent' }));

    // Merge into lifelog
    const lifelogMessages = [...sent, ...todaysInbox];
    const merged = this.mergeByDate(existingData, lifelogMessages);

    return {
      current: {
        lastUpdated: nowTs24(),
        unreadCount: inboxMessages.filter(m => m.isUnread).length,
        totalCount: inboxMessages.length,
        messages: inboxMessages
      },
      lifelog: merged,
      stats: {
        inbox: inboxMessages.length,
        sent: sentMessages.length,
        todaysReceived: todaysInbox.length
      }
    };
  }

  /**
   * Get adapter metrics
   */
  getMetrics() {
    return {
      uptime: {
        ms: Date.now() - this.metrics.startedAt,
        formatted: this.formatDuration(Date.now() - this.metrics.startedAt)
      },
      totals: {
        emailsFetched: this.metrics.emailsFetched,
        emailsSent: this.metrics.emailsSent,
        errors: this.metrics.errors
      }
    };
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }

  /**
   * Check if adapter is configured
   */
  isConfigured() {
    return !!this.googleAuth;
  }
}

export default GmailAdapter;
