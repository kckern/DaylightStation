function notificationDto(notification) {
  return {
    id: notification.id, recipient: notification.recipient, channel: notification.channel,
    title: notification.title, body: notification.body, priority: notification.priority,
    sentAt: notification.sentAt, readAt: notification.readAt, metadata: notification.metadata,
  };
}

function messageDto(message) {
  return {
    id: message.id, conversationId: message.conversationId, senderId: message.senderId,
    recipientId: message.recipientId, type: message.type, direction: message.direction,
    content: message.content, attachments: message.attachments, timestamp: message.timestamp,
    metadata: message.metadata,
  };
}

function conversationDto(conversation) {
  return {
    id: conversation.id, participants: conversation.participants,
    messages: conversation.messages.map(messageDto), startedAt: conversation.startedAt,
    lastMessageAt: conversation.lastMessageAt, metadata: conversation.metadata,
  };
}

/** HTTP-facing projections around injected messaging operations. */
export class MessagingHttpFacade {
  #conversations; #notifications; #telegram; #email; #timestamp; #nowMs;
  constructor({ conversationService = null, notificationService = null, telegram = null, email = null,
    timestamp, nowMs } = {}) {
    if (typeof timestamp !== 'function' || typeof nowMs !== 'function') {
      throw new TypeError('MessagingHttpFacade requires timestamp and nowMs');
    }
    this.#conversations = conversationService; this.#notifications = notificationService;
    this.#telegram = telegram; this.#email = email; this.#timestamp = timestamp; this.#nowMs = nowMs;
  }
  overview() {
    return { channels: { telegram: this.#telegram?.isConfigured() || false, email: this.#email?.isConfigured() || false },
      services: { conversations: !!this.#conversations, notifications: !!this.#notifications } };
  }
  hasConversations() { return !!this.#conversations; }
  hasNotifications() { return !!this.#notifications; }
  telegramConfigured() { return this.#telegram?.isConfigured() || false; }
  emailConfigured() { return this.#email?.isConfigured() || false; }
  async conversations({ participant, active }) {
    let conversations;
    if (participant) conversations = await this.#conversations.getConversationsForParticipant(participant);
    else if (active === 'true') conversations = await this.#conversations.getActiveConversations();
    else conversations = [];
    return { conversations: await Promise.all(conversations.map(item => this.#conversations.getConversationSummary(item.id))) };
  }
  async conversation(id) {
    const conversation = await this.#conversations.getConversation(id);
    return conversation ? { conversation: conversationDto(conversation) } : null;
  }
  async createConversation({ participants, metadata }) {
    const conversation = await this.#conversations.createConversation({
      participants, nowMs: this.#nowMs(), timestamp: this.#timestamp(), metadata,
    });
    return { conversation: conversationDto(conversation) };
  }
  async addMessage(id, { senderId, content, type, metadata }) {
    try {
      const message = await this.#conversations.addMessage(id, { senderId, content, type, metadata }, this.#timestamp());
      return { kind: 'ok', body: { message: messageDto(message) } };
    } catch (error) {
      if (error.message.includes('not found')) return { kind: 'not_found', error: error.message };
      throw error;
    }
  }
  async messages(id, filters) {
    const messages = await this.#conversations.getMessages(id, filters);
    return { messages: messages.map(messageDto) };
  }
  async notifications({ recipient, unread }) {
    const notifications = unread === 'true'
      ? await this.#notifications.getUnreadNotifications(recipient)
      : await this.#notifications.getNotificationsForRecipient(recipient);
    return { notifications: notifications.map(notificationDto), count: notifications.length };
  }
  async sendNotification(input) {
    const notification = await this.#notifications.send(input, this.#nowMs(), this.#timestamp());
    return { notification: notificationDto(notification), sent: notification.isSent() };
  }
  async markNotificationRead(id) {
    try {
      const notification = await this.#notifications.markRead(id, this.#timestamp());
      return { kind: 'ok', body: { notification: notificationDto(notification) } };
    } catch (error) {
      if (error.message.includes('not found')) return { kind: 'not_found', error: error.message };
      throw error;
    }
  }
  async telegramStatus() {
    if (!this.telegramConfigured()) return { configured: false };
    const [botInfo, webhookInfo] = await Promise.all([this.#telegram.getBotInfo(), this.#telegram.getWebhookInfo()]);
    return { configured: true,
      bot: { id: botInfo.id, username: botInfo.username, firstName: botInfo.first_name },
      webhook: { url: webhookInfo.url || null, pendingUpdates: webhookInfo.pending_update_count,
        lastError: webhookInfo.last_error_message || null } };
  }
  async sendTelegram(chatId, text, options) { return this.#telegram.sendMessage(chatId, text, options || {}); }
  async inbox(maxResults) {
    const messages = await this.#email.getInboxMessages({ maxResults: maxResults ? parseInt(maxResults, 10) : 50 });
    return { messages, count: messages.length, unreadCount: messages.filter(message => message.isUnread).length };
  }
  async harvestEmail() {
    const result = await this.#email.harvestEmails();
    return { ok: true, stats: result.stats, lifelogDates: Object.keys(result.lifelog).length };
  }
  metrics() {
    return {
      telegram: this.telegramConfigured() ? this.#telegram.getMetrics() : { configured: false },
      email: this.emailConfigured() ? this.#email.getMetrics() : { configured: false },
    };
  }
}
