/**
 * Messaging Domain
 * @module domains/messaging
 *
 * Domain for managing conversations, messages, and notifications.
 * Supports multiple channels: Telegram, Email, Push, SMS.
 */

// Value Objects
export * from './value-objects/index.mjs';

// Entities
export {
  Notification,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES
} from './entities/Notification.mjs';
export { Conversation } from './entities/Conversation.mjs';
export { Message } from './entities/Message.mjs';

// Ports (re-exported from application layer - canonical location per DDD)
export {
  INotificationChannel,
  IMessagingGateway,
  isMessagingGateway,
  IConversationDatastore,
  IConversationStateDatastore,
  isConversationStateDatastore
} from '#apps/shared/ports/index.mjs';

// Services
export { NotificationService } from './services/NotificationService.mjs';
export { ConversationService } from './services/ConversationService.mjs';
