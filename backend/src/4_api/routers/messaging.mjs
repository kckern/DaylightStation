/**
 * Messaging API Router
 *
 * Endpoints:
 * - GET  /api/messaging - Get messaging config
 * - GET  /api/messaging/conversations - List conversations
 * - GET  /api/messaging/conversations/:id - Get conversation detail
 * - POST /api/messaging/conversations - Create conversation
 * - POST /api/messaging/conversations/:id/messages - Add message
 * - GET  /api/messaging/notifications - Get notifications
 * - POST /api/messaging/notifications - Send notification
 * - POST /api/messaging/notifications/:id/read - Mark notification read
 * - GET  /api/messaging/email/inbox - Get email inbox
 * - POST /api/messaging/email/harvest - Trigger email harvest
 * - GET  /api/messaging/metrics - Get adapter metrics
 */
import express from 'express';
import { nowTs24 } from '../../0_system/utils/index.mjs';

/**
 * Create messaging API router
 *
 * @param {Object} config
 * @param {Object} config.conversationService - ConversationService instance
 * @param {Object} config.notificationService - NotificationService instance
 * @param {Object} config.telegramAdapter - TelegramAdapter instance (optional)
 * @param {Object} config.gmailAdapter - GmailAdapter instance (optional)
 * @param {Object} config.configService - ConfigService
 * @param {Object} config.logger - Logger instance
 * @returns {express.Router}
 */
export function createMessagingRouter(config) {
  const {
    conversationService,
    notificationService,
    telegramAdapter,
    gmailAdapter,
    configService,
    logger = console
  } = config;

  const router = express.Router();

  /**
   * Resolve household ID from query or use default
   */
  function resolveHouseholdId(queryHousehold) {
    return queryHousehold || configService?.getDefaultHouseholdId() || 'default';
  }

  // =============================================================================
  // Config & Overview
  // =============================================================================

  /**
   * GET /api/messaging - Get messaging config overview
   */
  router.get('/', (req, res) => {
    res.json({
      channels: {
        telegram: telegramAdapter?.isConfigured() || false,
        email: gmailAdapter?.isConfigured() || false
      },
      services: {
        conversations: !!conversationService,
        notifications: !!notificationService
      }
    });
  });

  // =============================================================================
  // Conversations
  // =============================================================================

  /**
   * GET /api/messaging/conversations - List conversations
   */
  router.get('/conversations', async (req, res) => {
    if (!conversationService) {
      return res.status(503).json({ error: 'Conversation service not configured' });
    }

    const { participant, active } = req.query;

    try {
      let conversations;
      if (participant) {
        conversations = await conversationService.getConversationsForParticipant(participant);
      } else if (active === 'true') {
        conversations = await conversationService.getActiveConversations();
      } else {
        conversations = [];
      }

      const summaries = await Promise.all(
        conversations.map(c => conversationService.getConversationSummary(c.id))
      );

      return res.json({ conversations: summaries });
    } catch (error) {
      logger.error?.('messaging.conversations.list.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to list conversations' });
    }
  });

  /**
   * GET /api/messaging/conversations/:id - Get conversation detail
   */
  router.get('/conversations/:id', async (req, res) => {
    if (!conversationService) {
      return res.status(503).json({ error: 'Conversation service not configured' });
    }

    const { id } = req.params;

    try {
      const conversation = await conversationService.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      return res.json({ conversation: conversation.toJSON() });
    } catch (error) {
      logger.error?.('messaging.conversations.detail.error', { id, error: error.message });
      return res.status(500).json({ error: 'Failed to get conversation' });
    }
  });

  /**
   * POST /api/messaging/conversations - Create conversation
   */
  router.post('/conversations', async (req, res) => {
    if (!conversationService) {
      return res.status(503).json({ error: 'Conversation service not configured' });
    }

    const { participants, metadata } = req.body;

    if (!participants || !Array.isArray(participants) || participants.length < 2) {
      return res.status(400).json({ error: 'At least 2 participants required' });
    }

    try {
      const nowMs = Date.now();
      const timestamp = nowTs24();
      const conversation = await conversationService.createConversation({
        participants,
        nowMs,
        timestamp,
        metadata
      });

      return res.status(201).json({ conversation: conversation.toJSON() });
    } catch (error) {
      logger.error?.('messaging.conversations.create.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  /**
   * POST /api/messaging/conversations/:id/messages - Add message
   */
  router.post('/conversations/:id/messages', async (req, res) => {
    if (!conversationService) {
      return res.status(503).json({ error: 'Conversation service not configured' });
    }

    const { id } = req.params;
    const { senderId, content, type = 'text', metadata } = req.body;

    if (!senderId || !content) {
      return res.status(400).json({ error: 'senderId and content required' });
    }

    try {
      const timestamp = nowTs24();
      const message = await conversationService.addMessage(id, {
        senderId,
        content,
        type,
        metadata
      }, timestamp);

      return res.status(201).json({ message: message.toJSON() });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      logger.error?.('messaging.conversations.message.error', { id, error: error.message });
      return res.status(500).json({ error: 'Failed to add message' });
    }
  });

  /**
   * GET /api/messaging/conversations/:id/messages - Get messages
   */
  router.get('/conversations/:id/messages', async (req, res) => {
    if (!conversationService) {
      return res.status(503).json({ error: 'Conversation service not configured' });
    }

    const { id } = req.params;
    const { limit, since, type, senderId } = req.query;

    try {
      const messages = await conversationService.getMessages(id, {
        limit: limit ? parseInt(limit, 10) : undefined,
        since,
        type,
        senderId
      });

      return res.json({ messages: messages.map(m => m.toJSON()) });
    } catch (error) {
      logger.error?.('messaging.conversations.messages.error', { id, error: error.message });
      return res.status(500).json({ error: 'Failed to get messages' });
    }
  });

  // =============================================================================
  // Notifications
  // =============================================================================

  /**
   * GET /api/messaging/notifications - Get notifications
   */
  router.get('/notifications', async (req, res) => {
    if (!notificationService) {
      return res.status(503).json({ error: 'Notification service not configured' });
    }

    const { recipient, unread } = req.query;

    if (!recipient) {
      return res.status(400).json({ error: 'recipient query param required' });
    }

    try {
      let notifications;
      if (unread === 'true') {
        notifications = await notificationService.getUnreadNotifications(recipient);
      } else {
        notifications = await notificationService.getNotificationsForRecipient(recipient);
      }

      return res.json({
        notifications: notifications.map(n => n.toJSON()),
        count: notifications.length
      });
    } catch (error) {
      logger.error?.('messaging.notifications.list.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to get notifications' });
    }
  });

  /**
   * POST /api/messaging/notifications - Send notification
   */
  router.post('/notifications', async (req, res) => {
    if (!notificationService) {
      return res.status(503).json({ error: 'Notification service not configured' });
    }

    const { recipient, channel, title, body, priority, metadata } = req.body;

    if (!recipient || !channel || !body) {
      return res.status(400).json({ error: 'recipient, channel, and body required' });
    }

    try {
      const nowMs = Date.now();
      const timestamp = nowTs24();
      const notification = await notificationService.send({
        recipient,
        channel,
        title,
        body,
        priority,
        metadata
      }, nowMs, timestamp);

      return res.status(201).json({
        notification: notification.toJSON(),
        sent: notification.isSent()
      });
    } catch (error) {
      logger.error?.('messaging.notifications.send.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to send notification' });
    }
  });

  /**
   * POST /api/messaging/notifications/:id/read - Mark notification read
   */
  router.post('/notifications/:id/read', async (req, res) => {
    if (!notificationService) {
      return res.status(503).json({ error: 'Notification service not configured' });
    }

    const { id } = req.params;

    try {
      const timestamp = nowTs24();
      const notification = await notificationService.markRead(id, timestamp);
      return res.json({ notification: notification.toJSON() });
    } catch (error) {
      if (error.message.includes('not found')) {
        return res.status(404).json({ error: error.message });
      }
      logger.error?.('messaging.notifications.read.error', { id, error: error.message });
      return res.status(500).json({ error: 'Failed to mark notification read' });
    }
  });

  // =============================================================================
  // Telegram
  // =============================================================================

  /**
   * GET /api/messaging/telegram/status - Get Telegram bot status
   */
  router.get('/telegram/status', async (req, res) => {
    if (!telegramAdapter?.isConfigured()) {
      return res.json({ configured: false });
    }

    try {
      const [botInfo, webhookInfo] = await Promise.all([
        telegramAdapter.getBotInfo(),
        telegramAdapter.getWebhookInfo()
      ]);

      return res.json({
        configured: true,
        bot: {
          id: botInfo.id,
          username: botInfo.username,
          firstName: botInfo.first_name
        },
        webhook: {
          url: webhookInfo.url || null,
          pendingUpdates: webhookInfo.pending_update_count,
          lastError: webhookInfo.last_error_message || null
        }
      });
    } catch (error) {
      logger.error?.('messaging.telegram.status.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to get Telegram status' });
    }
  });

  /**
   * POST /api/messaging/telegram/send - Send Telegram message
   */
  router.post('/telegram/send', async (req, res) => {
    if (!telegramAdapter?.isConfigured()) {
      return res.status(503).json({ error: 'Telegram adapter not configured' });
    }

    const { chatId, text, options } = req.body;

    if (!chatId || !text) {
      return res.status(400).json({ error: 'chatId and text required' });
    }

    try {
      const result = await telegramAdapter.sendMessage(chatId, text, options || {});
      return res.json(result);
    } catch (error) {
      logger.error?.('messaging.telegram.send.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to send Telegram message' });
    }
  });

  // =============================================================================
  // Email
  // =============================================================================

  /**
   * GET /api/messaging/email/inbox - Get email inbox
   */
  router.get('/email/inbox', async (req, res) => {
    if (!gmailAdapter?.isConfigured()) {
      return res.status(503).json({ error: 'Gmail adapter not configured' });
    }

    const { maxResults } = req.query;

    try {
      const messages = await gmailAdapter.getInboxMessages({
        maxResults: maxResults ? parseInt(maxResults, 10) : 50
      });

      return res.json({
        messages,
        count: messages.length,
        unreadCount: messages.filter(m => m.isUnread).length
      });
    } catch (error) {
      logger.error?.('messaging.email.inbox.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to get inbox' });
    }
  });

  /**
   * POST /api/messaging/email/harvest - Trigger email harvest
   */
  router.post('/email/harvest', async (req, res) => {
    if (!gmailAdapter?.isConfigured()) {
      return res.status(503).json({ error: 'Gmail adapter not configured' });
    }

    try {
      const result = await gmailAdapter.harvestEmails();
      return res.json({
        ok: true,
        stats: result.stats,
        lifelogDates: Object.keys(result.lifelog).length
      });
    } catch (error) {
      logger.error?.('messaging.email.harvest.error', { error: error.message });
      return res.status(500).json({ error: 'Failed to harvest emails' });
    }
  });

  // =============================================================================
  // Metrics
  // =============================================================================

  /**
   * GET /api/messaging/metrics - Get adapter metrics
   */
  router.get('/metrics', (req, res) => {
    const metrics = {
      telegram: telegramAdapter?.isConfigured()
        ? telegramAdapter.getMetrics()
        : { configured: false },
      email: gmailAdapter?.isConfigured()
        ? gmailAdapter.getMetrics()
        : { configured: false }
    };

    return res.json(metrics);
  });

  return router;
}

export default createMessagingRouter;
