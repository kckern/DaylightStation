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

// Ports (re-exported from application layer - canonical location per DDD)
export {
  INotificationChannel,
  IMessagingGateway,
  isMessagingGateway,
  IConversationStore,
  IConversationStateStore,
  isConversationStateStore
} from '../../3_applications/shared/ports/index.mjs';

// Services
export { NotificationService } from './services/NotificationService.mjs';
export { ConversationService } from './services/ConversationService.mjs';
