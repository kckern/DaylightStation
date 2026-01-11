/**
 * AI Gateway Port Interface
 * @module application/ports/IAIGateway
 * 
 * @deprecated This file has been moved to backend/lib/ai/IAIGateway.mjs
 * Import from '../../../lib/ai/index.mjs' or 'backend/lib/ai/index.mjs' instead.
 * This file is kept for backward compatibility and will be removed in a future version.
 */

// Re-export from canonical location
export {
  isAIGateway,
  assertAIGateway,
  systemMessage,
  userMessage,
  assistantMessage,
} from '../../../lib/ai/IAIGateway.mjs';

export default {
  isAIGateway: (await import('../../../lib/ai/IAIGateway.mjs')).isAIGateway,
  assertAIGateway: (await import('../../../lib/ai/IAIGateway.mjs')).assertAIGateway,
  systemMessage: (await import('../../../lib/ai/IAIGateway.mjs')).systemMessage,
  userMessage: (await import('../../../lib/ai/IAIGateway.mjs')).userMessage,
  assistantMessage: (await import('../../../lib/ai/IAIGateway.mjs')).assistantMessage,
};
