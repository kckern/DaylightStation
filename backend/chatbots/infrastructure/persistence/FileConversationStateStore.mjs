/**
 * File-based Conversation State Store
 * @module infrastructure/persistence/FileConversationStateStore
 * 
 * Uses loadFile/saveFile from backend/lib/io.mjs
 */

import { loadFile, saveFile } from '../../../lib/io.mjs';
import { ConversationState } from '../../domain/entities/ConversationState.mjs';
import { ChatId } from '../../domain/value-objects/ChatId.mjs';
import { Timestamp } from '../../domain/value-objects/Timestamp.mjs';
import { createLogger } from '../../_lib/logging/index.mjs';

const DEFAULT_TTL_SECONDS = 3600; // 1 hour

/**
 * File-based implementation of IConversationStateStore
 * Stores state in YAML files using io.mjs
 */
export class FileConversationStateStore {
  #storePath;
  #defaultTTL;
  #logger;
  #userResolver;
  #pathResolver;

  /**
   * @param {Object} options
   * @param {string} options.storePath - Path relative to data dir (base path)
   * @param {number} [options.defaultTTL=3600] - Default TTL in seconds
   * @param {Object} [options.logger] - Logger instance
   * @param {Object} [options.userResolver] - UserResolver for username lookups
   * @param {Function} [options.pathResolver] - Custom path resolver function(chatId) => path
   */
  constructor(options) {
    if (!options?.storePath) {
      throw new Error('storePath is required');
    }

    this.#storePath = options.storePath;
    this.#defaultTTL = options.defaultTTL || DEFAULT_TTL_SECONDS;
    this.#logger = options.logger || createLogger({ source: 'state-store', app: 'file' });
    this.#userResolver = options.userResolver || null;
    this.#pathResolver = options.pathResolver || null;
  }

  /**
   * Get file path for a chat
   * @private
   * @param {ChatId} chatId
   * @returns {string}
   */
  #getPath(chatId) {
    const id = chatId instanceof ChatId ? chatId.toString() : ChatId.from(chatId).toString();
    
    // Use custom path resolver if provided
    if (this.#pathResolver) {
      return this.#pathResolver(id);
    }
    
    // Use UserResolver to get username-based path
    if (this.#userResolver) {
      const username = this.#userResolver.resolveUsername(id);
      if (username) {
        return `${this.#storePath}/${username}/nutricursor`;
      }
    }
    
    // Fallback to chat ID based path
    return `${this.#storePath}/${id}`;
  }

  /**
   * Get current conversation state
   * @param {ChatId} chatId
   * @returns {Promise<ConversationState | null>}
   */
  async get(chatId) {
    const path = this.#getPath(chatId);
    
    // CRITICAL DEBUG: Log at INFO level to see in production
    this.#logger.info('state-store.get', { 
      chatId: chatId?.toString?.() || String(chatId),
      path,
      storePath: this.#storePath,
    });

    const data = loadFile(path);
    
    // CRITICAL DEBUG: Log whether file was found
    this.#logger.info('state-store.get.result', {
      chatId: chatId?.toString?.() || String(chatId),
      path,
      fileFound: !!data,
      activeFlow: data?.activeFlow || 'none',
    });
    
    if (!data) return null;

    // Convert to ConversationState
    const state = ConversationState.from({
      chatId,
      activeFlow: data.activeFlow || null,
      flowState: data.flowState || {},
      lastMessageId: data.lastMessageId || null,
      updatedAt: data.updatedAt,
      expiresAt: data.expiresAt,
    });

    // NOTE: We no longer expire sessions based on time alone.
    // Sessions only get cleared when:
    // 1. User sends a new message (starts fresh flow)
    // 2. User completes the flow (explicit clear)
    // 3. User cancels (explicit clear)

    return state;
  }

  /**
   * Set conversation state
   * @param {ChatId} chatId
   * @param {ConversationState} state
   * @returns {Promise<void>}
   */
  async set(chatId, state) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('state-store.set', { 
      chatId: chatId.toString(),
      activeFlow: state.activeFlow,
    });

    const data = {
      activeFlow: state.activeFlow,
      flowState: state.flowState,
      lastMessageId: state.lastMessageId?.toString() || null,
      updatedAt: state.updatedAt.toISOString(),
      expiresAt: state.expiresAt.toISOString(),
    };

    saveFile(path, data);
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
      // Create new state
      state = ConversationState.empty(chatId);
    }

    // Apply changes
    if (changes.activeFlow !== undefined) {
      state = state.with({ activeFlow: changes.activeFlow });
    }
    
    if (changes.flowState) {
      state = state.updateFlowState(changes.flowState);
    }

    // Save
    await this.set(chatId, state);
    
    return state;
  }

  /**
   * Clear all state for a chat
   * @param {ChatId} chatId
   * @returns {Promise<void>}
   */
  async clear(chatId) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('state-store.clear', { chatId: chatId.toString() });

    // Save empty object to clear
    saveFile(path, {});
  }

  /**
   * Delete state for a chat (alias for clear)
   * @param {ChatId|string} chatId
   * @returns {Promise<void>}
   */
  async delete(chatId) {
    return this.clear(chatId);
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
      this.#logger.debug('state-store.clearFlow.noMatch', { 
        chatId: chatId.toString(),
        targetFlow: flowName,
        activeFlow: state?.activeFlow,
      });
      return;
    }

    this.#logger.debug('state-store.clearFlow', { 
      chatId: chatId.toString(),
      flowName,
    });

    const cleared = state.clearFlow();
    await this.set(chatId, cleared);
  }
}

export default FileConversationStateStore;
