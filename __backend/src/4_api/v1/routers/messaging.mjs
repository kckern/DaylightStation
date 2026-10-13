import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createMessagingRouter({ messagingService }) {
  const router = express.Router();

  router.get('/', (req, res) => res.json(messagingService.overview()));

  router.get('/conversations', asyncHandler(async (req, res) => {
    if (!messagingService.hasConversations()) return res.status(503).json({ error: 'Conversation service not configured' });
    const { participant, active } = req.query;
    return res.json(await messagingService.conversations({ participant, active }));
  }));

  router.get('/conversations/:id', asyncHandler(async (req, res) => {
    if (!messagingService.hasConversations()) return res.status(503).json({ error: 'Conversation service not configured' });
    const result = await messagingService.conversation(req.params.id);
    if (!result) return res.status(404).json({ error: 'Conversation not found' });
    return res.json(result);
  }));

  router.post('/conversations', asyncHandler(async (req, res) => {
    if (!messagingService.hasConversations()) return res.status(503).json({ error: 'Conversation service not configured' });
    const { participants, metadata } = req.body;
    if (!participants || !Array.isArray(participants) || participants.length < 2) {
      return res.status(400).json({ error: 'At least 2 participants required' });
    }
    return res.status(201).json(await messagingService.createConversation({ participants, metadata }));
  }));

  router.post('/conversations/:id/messages', asyncHandler(async (req, res) => {
    if (!messagingService.hasConversations()) return res.status(503).json({ error: 'Conversation service not configured' });
    const { senderId, content, type = 'text', metadata } = req.body;
    if (!senderId || !content) return res.status(400).json({ error: 'senderId and content required' });
    const result = await messagingService.addMessage(req.params.id, { senderId, content, type, metadata });
    if (result.kind === 'not_found') return res.status(404).json({ error: result.error });
    return res.status(201).json(result.body);
  }));

  router.get('/conversations/:id/messages', asyncHandler(async (req, res) => {
    if (!messagingService.hasConversations()) return res.status(503).json({ error: 'Conversation service not configured' });
    const { limit, since, type, senderId } = req.query;
    return res.json(await messagingService.messages(req.params.id, {
      limit: limit ? parseInt(limit, 10) : undefined, since, type, senderId,
    }));
  }));

  router.get('/notifications', asyncHandler(async (req, res) => {
    if (!messagingService.hasNotifications()) return res.status(503).json({ error: 'Notification service not configured' });
    const { recipient, unread } = req.query;
    if (!recipient) return res.status(400).json({ error: 'recipient query param required' });
    return res.json(await messagingService.notifications({ recipient, unread }));
  }));

  router.post('/notifications', asyncHandler(async (req, res) => {
    if (!messagingService.hasNotifications()) return res.status(503).json({ error: 'Notification service not configured' });
    const { recipient, channel, title, body, priority, metadata } = req.body;
    if (!recipient || !channel || !body) return res.status(400).json({ error: 'recipient, channel, and body required' });
    return res.status(201).json(await messagingService.sendNotification({ recipient, channel, title, body, priority, metadata }));
  }));

  router.post('/notifications/:id/read', asyncHandler(async (req, res) => {
    if (!messagingService.hasNotifications()) return res.status(503).json({ error: 'Notification service not configured' });
    const result = await messagingService.markNotificationRead(req.params.id);
    if (result.kind === 'not_found') return res.status(404).json({ error: result.error });
    return res.json(result.body);
  }));

  router.get('/telegram/status', asyncHandler(async (req, res) => res.json(await messagingService.telegramStatus())));

  router.post('/telegram/send', asyncHandler(async (req, res) => {
    if (!messagingService.telegramConfigured()) return res.status(503).json({ error: 'Telegram adapter not configured' });
    const { chatId, text, options } = req.body;
    if (!chatId || !text) return res.status(400).json({ error: 'chatId and text required' });
    return res.json(await messagingService.sendTelegram(chatId, text, options));
  }));

  router.get('/email/inbox', asyncHandler(async (req, res) => {
    if (!messagingService.emailConfigured()) return res.status(503).json({ error: 'Gmail adapter not configured' });
    return res.json(await messagingService.inbox(req.query.maxResults));
  }));

  router.post('/email/harvest', asyncHandler(async (req, res) => {
    if (!messagingService.emailConfigured()) return res.status(503).json({ error: 'Gmail adapter not configured' });
    return res.json(await messagingService.harvestEmail());
  }));

  router.get('/metrics', (req, res) => res.json(messagingService.metrics()));

  return router;
}

export default createMessagingRouter;
