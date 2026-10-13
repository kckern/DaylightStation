import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { MessagingHttpFacade } from '#api/v1/presenters/MessagingHttpFacade.mjs';
import { createMessagingRouter } from './messaging.mjs';

const message = { id: 'm1', conversationId: 'c1', senderId: 'a', recipientId: 'b', type: 'text',
  direction: 'outbound', content: 'hello', attachments: [], timestamp: '2026-08-28 10:00:00', metadata: {} };
const conversation = { id: 'c1', participants: ['a', 'b'], messages: [message],
  startedAt: '2026-08-28 10:00:00', lastMessageAt: '2026-08-28 10:00:00', metadata: {} };
const notification = { id: 'n1', recipient: 'a', channel: 'telegram', title: 'Title', body: 'Body',
  priority: 'normal', sentAt: '2026-08-28 10:00:00', readAt: null, metadata: {}, isSent: () => true };

function build(overrides = {}) {
  const conversationService = {
    getConversationsForParticipant: vi.fn(async () => [{ id: 'c1' }]),
    getActiveConversations: vi.fn(async () => [{ id: 'c1' }]),
    getConversationSummary: vi.fn(async () => ({ id: 'c1', messageCount: 1 })),
    getConversation: vi.fn(async () => conversation),
    createConversation: vi.fn(async () => conversation),
    addMessage: vi.fn(async () => message),
    getMessages: vi.fn(async () => [message]),
  };
  const notificationService = {
    getUnreadNotifications: vi.fn(async () => [notification]),
    getNotificationsForRecipient: vi.fn(async () => [notification]),
    send: vi.fn(async () => notification),
    markRead: vi.fn(async () => ({ ...notification, readAt: '2026-08-28 10:01:00' })),
  };
  const telegram = {
    isConfigured: vi.fn(() => true), getBotInfo: vi.fn(async () => ({ id: 7, username: 'bot', first_name: 'Daylight' })),
    getWebhookInfo: vi.fn(async () => ({ url: '', pending_update_count: 2, last_error_message: '' })),
    sendMessage: vi.fn(async () => ({ ok: true, messageId: '9' })), getMetrics: vi.fn(() => ({ requests: 3 })),
  };
  const email = {
    isConfigured: vi.fn(() => true),
    getInboxMessages: vi.fn(async () => [{ id: 'e1', isUnread: true }, { id: 'e2', isUnread: false }]),
    harvestEmails: vi.fn(async () => ({ stats: { fetched: 2 }, lifelog: { '2026-08-28': [] } })),
    getMetrics: vi.fn(() => ({ emailsFetched: 2 })),
  };
  const deps = { conversationService, notificationService, telegram, email,
    timestamp: () => '2026-08-28 10:00:00', nowMs: () => 123, ...overrides };
  const app = express(); app.use(express.json());
  const messagingService = new MessagingHttpFacade(deps);
  app.use('/messaging', createMessagingRouter({ messagingService }));
  return { app, conversationService, notificationService, telegram, email };
}

describe('messaging route characterization', () => {
  it('preserves conversation and notification envelopes, statuses, and filters', async () => {
    const { app, conversationService, notificationService } = build();
    expect((await request(app).get('/messaging')).body).toEqual({
      channels: { telegram: true, email: true }, services: { conversations: true, notifications: true },
    });
    expect((await request(app).get('/messaging/conversations?participant=a')).body)
      .toEqual({ conversations: [{ id: 'c1', messageCount: 1 }] });
    expect((await request(app).get('/messaging/conversations/c1')).body.conversation).toMatchObject({ id: 'c1', messages: [message] });
    expect((await request(app).post('/messaging/conversations').send({ participants: ['a', 'b'] })).status).toBe(201);
    expect(conversationService.createConversation).toHaveBeenCalledWith(expect.objectContaining({ nowMs: 123, timestamp: '2026-08-28 10:00:00' }));
    expect((await request(app).post('/messaging/conversations/c1/messages').send({ senderId: 'a', content: 'hello' })).status).toBe(201);
    expect((await request(app).get('/messaging/conversations/c1/messages?limit=4')).body).toEqual({ messages: [message] });
    expect(conversationService.getMessages).toHaveBeenCalledWith('c1', { limit: 4, since: undefined, type: undefined, senderId: undefined });
    expect((await request(app).get('/messaging/notifications?recipient=a&unread=true')).body.count).toBe(1);
    expect(notificationService.getUnreadNotifications).toHaveBeenCalledWith('a');
    expect((await request(app).post('/messaging/notifications').send({ recipient: 'a', channel: 'telegram', body: 'Body' })).status).toBe(201);
    expect((await request(app).post('/messaging/notifications/n1/read')).body.notification.readAt).toBe('2026-08-28 10:01:00');
  });

  it('preserves Telegram, email inbox/harvest, and metrics payloads', async () => {
    const { app, telegram, email } = build();
    expect((await request(app).get('/messaging/telegram/status')).body).toEqual({ configured: true,
      bot: { id: 7, username: 'bot', firstName: 'Daylight' },
      webhook: { url: null, pendingUpdates: 2, lastError: null } });
    expect((await request(app).post('/messaging/telegram/send').send({ chatId: '4', text: 'hi' })).body)
      .toEqual({ ok: true, messageId: '9' });
    expect(telegram.sendMessage).toHaveBeenCalledWith('4', 'hi', {});
    expect((await request(app).get('/messaging/email/inbox?maxResults=7')).body)
      .toEqual({ messages: [{ id: 'e1', isUnread: true }, { id: 'e2', isUnread: false }], count: 2, unreadCount: 1 });
    expect(email.getInboxMessages).toHaveBeenCalledWith({ maxResults: 7 });
    expect((await request(app).post('/messaging/email/harvest')).body)
      .toEqual({ ok: true, stats: { fetched: 2 }, lifelogDates: 1 });
    expect((await request(app).get('/messaging/metrics')).body)
      .toEqual({ telegram: { requests: 3 }, email: { emailsFetched: 2 } });
  });

  it('keeps provider availability checks ahead of payload validation', async () => {
    const { app } = build({ telegram: null, email: null });
    expect((await request(app).post('/messaging/telegram/send').send({})).body)
      .toEqual({ error: 'Telegram adapter not configured' });
    expect((await request(app).get('/messaging/email/inbox')).status).toBe(503);
  });
});
