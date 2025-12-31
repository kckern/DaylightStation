/**
 * Application ports barrel export
 * @module application/ports
 */

export {
  isMessagingGateway,
  assertMessagingGateway,
} from './IMessagingGateway.mjs';

// Re-export from shared lib/ai module (canonical location)
export {
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage,
} from '../../../lib/ai/index.mjs';

export {
  isRepository,
  assertRepository,
} from './IRepository.mjs';

export {
  isConversationStateStore,
  assertConversationStateStore,
} from './IConversationStateStore.mjs';
