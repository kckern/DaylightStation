/**
 * Messaging Domain
 * @module domains/messaging
 *
 * Domain for managing conversations, messages, and notifications.
 * Supports multiple channels: Telegram, Email, Push, SMS.
 */

// Entities
export {
  Notification,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES
} from './entities/Notification.mjs';
export { Conversation } from './entities/Conversation.mjs';
export { Message } from './entities/Message.mjs';

// Ports
export { INotificationChannel } from './ports/INotificationChannel.mjs';
export { IMessagingGateway, isMessagingGateway } from './ports/IMessagingGateway.mjs';
export { IConversationStore } from './ports/IConversationStore.mjs';

// Services
export { NotificationService } from './services/NotificationService.mjs';
export { ConversationService } from './services/ConversationService.mjs';
