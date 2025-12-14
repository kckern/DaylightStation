/**
 * In-Memory Conversation State Store
 * @module infrastructure/persistence/InMemoryStateStore
 * 
 * For testing purposes only
 */

import { ConversationState } from '../../domain/entities/ConversationState.mjs';
import { ChatId } from '../../domain/value-objects/ChatId.mjs';
import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';

/**
 * In-memory implementation of IConversationStateStore
 * Useful for testing without file I/O
 */
export class InMemoryStateStore {
  /** @type {Map<string, ConversationState>} */
  #states = new Map();
  
  /** @type {number} - Simulated time offset for testing */
  #timeOffset = 0;

  // ==================== IConversationStateStore Implementation ====================

  /**
   * Get current conversation state
   * @param {ChatId} chatId
   * @returns {Promise<ConversationState | null>}
   */
  async get(chatId) {
    const key = this.#getKey(chatId);
    const state = this.#states.get(key);
    
    if (!state) return null;

    // Check expiration with time offset
    if (this.#isExpired(state)) {
      this.#states.delete(key);
      return null;
    }

    return state;
  }

  /**
   * Set conversation state
   * @param {ChatId} chatId
   * @param {ConversationState} state
   * @returns {Promise<void>}
   */
  async set(chatId, state) {
    const key = this.#getKey(chatId);
    this.#states.set(key, state);
  }

  /**
   * Update conversation state
   * @param {ChatId} chatId
   * @param {Object} changes
   * @returns {Promise<ConversationState>}
   */
  async update(chatId, changes) {
    let state = await this.get(chatId);
    
    if (!state) {
      state = ConversationState.empty(chatId);
    }

    // Apply changes
    if (changes.activeFlow !== undefined) {
      state = state.with({ activeFlow: changes.activeFlow });
    }
    
    if (changes.flowState) {
      state = state.updateFlowState(changes.flowState);
    }

    await this.set(chatId, state);
    return state;
  }

  /**
   * Clear all state for a chat
   * @param {ChatId} chatId
   * @returns {Promise<void>}
   */
  async clear(chatId) {
    const key = this.#getKey(chatId);
    this.#states.delete(key);
  }

  /**
   * Clear state only if current flow matches
   * @param {ChatId} chatId
   * @param {string} flowName
   * @returns {Promise<void>}
   */
  async clearFlow(chatId, flowName) {
    const state = await this.get(chatId);
    
    if (!state || state.activeFlow !== flowName) {
      return;
    }

    const cleared = state.clearFlow();
    await this.set(chatId, cleared);
  }

  // ==================== Testing Helpers ====================

  /**
   * Directly set a state (bypassing normal set logic)
   * @param {ChatId} chatId
   * @param {ConversationState} state
   */
  setState(chatId, state) {
    const key = this.#getKey(chatId);
    this.#states.set(key, state);
  }

  /**
   * Advance simulated time for TTL testing
   * @param {number} ms - Milliseconds to advance
   */
  advanceTime(ms) {
    this.#timeOffset += ms;
  }

  /**
   * Reset time offset
   */
  resetTime() {
    this.#timeOffset = 0;
  }

  /**
   * Get current simulated time
   * @returns {number}
   */
  getCurrentTime() {
    return Date.now() + this.#timeOffset;
  }

  /**
   * Reset all state
   */
  reset() {
    this.#states.clear();
    this.#timeOffset = 0;
  }

  /**
   * Get all stored states
   * @returns {Map<string, ConversationState>}
   */
  getAllStates() {
    return new Map(this.#states);
  }

  /**
   * Get count of stored states
   * @returns {number}
   */
  get size() {
    return this.#states.size;
  }

  /**
   * Check if a chat has state
   * @param {ChatId} chatId
   * @returns {boolean}
   */
  has(chatId) {
    return this.#states.has(this.#getKey(chatId));
  }

  // ==================== Private Helpers ====================

  /**
   * Get storage key from ChatId
   * @private
   */
  #getKey(chatId) {
    if (chatId instanceof ChatId) {
      return chatId.toString();
    }
    return ChatId.from(chatId).toString();
  }

  /**
   * Check if state is expired (considering time offset)
   * @private
   */
  #isExpired(state) {
    const currentTime = this.getCurrentTime();
    // Handle both Timestamp objects and plain objects
    const expiresAt = state.expiresAt;
    const expiresMs = typeof expiresAt.toEpochMs === 'function' 
      ? expiresAt.toEpochMs() 
      : new Date(expiresAt).getTime();
    return expiresMs < currentTime;
  }
}

export default InMemoryStateStore;
