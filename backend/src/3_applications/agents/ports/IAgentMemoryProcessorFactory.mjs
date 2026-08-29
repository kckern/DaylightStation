/**
 * Constructs opaque agent-memory processors without exposing a particular
 * agent framework to application services.
 */
export class IAgentMemoryProcessorFactory {
  createObservationalProcessor(_options) {
    throw new Error('IAgentMemoryProcessorFactory.createObservationalProcessor must be implemented');
  }
}

export function isAgentMemoryProcessorFactory(value) {
  return value != null && typeof value.createObservationalProcessor === 'function';
}

export default IAgentMemoryProcessorFactory;
