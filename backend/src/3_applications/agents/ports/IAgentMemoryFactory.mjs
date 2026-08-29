/**
 * Constructs the opaque memory runtime consumed by an agent runtime.
 * Application code supplies semantic memory options; adapter code owns the
 * concrete persistence/runtime implementation.
 */
export class IAgentMemoryFactory {
  createMemory(_options) {
    throw new Error('IAgentMemoryFactory.createMemory must be implemented');
  }
}

export function isAgentMemoryFactory(value) {
  return value != null && typeof value.createMemory === 'function';
}

export default IAgentMemoryFactory;
