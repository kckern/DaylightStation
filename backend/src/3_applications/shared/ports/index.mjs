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
