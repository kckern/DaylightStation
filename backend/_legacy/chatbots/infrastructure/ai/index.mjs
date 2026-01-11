/**
 * AI infrastructure barrel export
 * @module infrastructure/ai
 * 
 * NOTE: AI gateway has been moved to shared lib/ai module.
 * This file re-exports for backward compatibility.
 */

// Re-export everything from shared lib/ai module (canonical location)
export { 
    OpenAIGateway,
    getAIGateway,
    createAIGateway,
    isAIGateway,
    assertAIGateway,
    systemMessage,
    userMessage,
    assistantMessage,
    AIError,
    AIServiceError,
    AIRateLimitError,
    AITimeoutError,
    isAIError,
    isRetryableAIError,
} from '../../../lib/ai/index.mjs';
