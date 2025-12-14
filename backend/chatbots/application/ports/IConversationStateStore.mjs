/**
 * Conversation State Store Port Interface
 * @module application/ports/IConversationStateStore
 */

import { ChatId } from '../../domain/value-objects/ChatId.mjs';
import { ConversationState } from '../../domain/entities/ConversationState.mjs';

/**
 * @typedef {Object} StateUpdateOptions
 * @property {string} [activeFlow] - New active flow name
 * @property {Object} [flowState] - Flow state updates (merged)
 * @property {boolean} [extendTTL=true] - Extend TTL on update
 */

/**
 * Abstract interface for ephemeral conversation state storage
 * 
 * Implementations:
 * - FileConversationStateStore: File-based persistence using io.mjs
 * - InMemoryStateStore: In-memory storage for testing
 * 
 * Unlike repositories, state stores are optimized for:
 * - Fast reads (cached in memory)
 * - TTL-based expiration
 * - Single active state per chat
 * 
 * @interface IConversationStateStore
 */

/**
 * @typedef {Object} IConversationStateStore
 * @property {function} get - Get current state for a chat
 * @property {function} set - Set state for a chat
 * @property {function} update - Update state for a chat
 * @property {function} clear - Clear all state for a chat
 * @property {function} clearFlow - Clear specific flow if active
 */

/**
 * Method signatures for IConversationStateStore:
 * 
 * get(chatId: ChatId): Promise<ConversationState | null>
 *   - Get current conversation state
 *   - Returns null if not set or expired
 * 
 * set(chatId: ChatId, state: ConversationState): Promise<void>
 *   - Set conversation state (replaces existing)
 * 
 * update(chatId: ChatId, changes: StateUpdateOptions): Promise<ConversationState>
 *   - Update existing state with changes
 *   - Creates new state if none exists
 *   - Returns updated state
 * 
 * clear(chatId: ChatId): Promise<void>
 *   - Remove all state for a chat
 * 
 * clearFlow(chatId: ChatId, flowName: string): Promise<void>
 *   - Clear state only if current flow matches flowName
 *   - No-op if different flow is active
 */

/**
 * Validate that an object implements IConversationStateStore
 * @param {Object} obj - Object to validate
 * @returns {boolean}
 */
export function isConversationStateStore(obj) {
  if (!obj || typeof obj !== 'object') return false;
  
  const requiredMethods = [
    'get',
    'set',
    'update',
    'clear',
    'clearFlow',
  ];
  
  return requiredMethods.every(method => typeof obj[method] === 'function');
}

/**
 * Create a type-safe wrapper that validates state store implementation
 * @template T
 * @param {T} store - State store implementation
 * @returns {T}
 * @throws {Error} if store doesn't implement IConversationStateStore
 */
export function assertConversationStateStore(store) {
  if (!isConversationStateStore(store)) {
    throw new Error('Object does not implement IConversationStateStore interface');
  }
  return store;
}

export default {
  isConversationStateStore,
  assertConversationStateStore,
};
