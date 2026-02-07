/**
 * Shared Application Ports
 *
 * Port interfaces for external systems used across multiple applications.
 * Per DDD: ports belong in application layer, not domain layer.
 */

export {
  IAIGateway,
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage
} from './IAIGateway.mjs';

export { ITranscriptionService } from './ITranscriptionService.mjs';

// Messaging ports
export { INotificationChannel } from './INotificationChannel.mjs';
export { IMessagingGateway, isMessagingGateway } from './IMessagingGateway.mjs';
export { IConversationStateDatastore, isConversationStateDatastore } from './IConversationStateDatastore.mjs';
export { IConversationDatastore } from './IConversationDatastore.mjs';
