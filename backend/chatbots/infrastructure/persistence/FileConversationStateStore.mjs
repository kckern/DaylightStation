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
    
    // Fallback to chat ID based path
    return `${this.#storePath}/${id}`;
  }

  /**
   * Get current conversation state
   * @param {ChatId} chatId
   * @param {string} [messageId] - Optional message ID to get specific session
   * @returns {Promise<ConversationState | null>}
   */
  async get(chatId, messageId = null) {
    const path = this.#getPath(chatId);
    
    // CRITICAL DEBUG: Log at INFO level to see in production
    this.#logger.info('state-store.get', { 
      chatId: chatId?.toString?.() || String(chatId),
      messageId,
      path,
      storePath: this.#storePath,
    });

    const data = loadFile(path);
    
    // If no data, return null
    if (!data) {
      this.#logger.info('state-store.get.result', {
        chatId: chatId?.toString?.() || String(chatId),
        path,
        fileFound: false,
      });
      return null;
    }
    
    // New format: sessions map keyed by messageId
    if (data.sessions && messageId) {
      const sessionData = data.sessions[messageId];
      if (!sessionData) {
        this.#logger.info('state-store.get.result', {
          chatId: chatId?.toString?.() || String(chatId),
          path,
          messageId,
          fileFound: true,
          sessionFound: false,
        });
        return null;
      }
      
      this.#logger.info('state-store.get.result', {
        chatId: chatId?.toString?.() || String(chatId),
        path,
        messageId,
        fileFound: true,
        sessionFound: true,
        activeFlow: sessionData.activeFlow,
      });
      
      return ConversationState.from({
        chatId,
        activeFlow: sessionData.activeFlow || null,
        flowState: sessionData.flowState || {},
        lastReportMessageId: sessionData.lastReportMessageId || null,
        updatedAt: sessionData.updatedAt,
        expiresAt: sessionData.expiresAt,
      });
    }
    
    // Legacy format: single session (backwards compatibility)
    this.#logger.info('state-store.get.result', {
      chatId: chatId?.toString?.() || String(chatId),
      path,
      fileFound: true,
      activeFlow: data?.activeFlow || 'none',
      format: 'legacy',
    });

    // Convert to ConversationState
    const state = ConversationState.from({
      chatId,
      activeFlow: data.activeFlow || null,
      flowState: data.flowState || {},
      lastReportMessageId: data.lastReportMessageId || null,
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
   * @param {string} [messageId] - Optional message ID to key the session
   * @returns {Promise<void>}
   */
  async set(chatId, state, messageId = null) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('state-store.set', { 
      chatId: chatId.toString(),
      messageId,
      activeFlow: state.activeFlow,
    });

    const sessionData = {
      activeFlow: state.activeFlow,
      flowState: state.flowState,
      lastReportMessageId: state.lastReportMessageId?.toString() || null,
      updatedAt: state.updatedAt.toISOString(),
      expiresAt: state.expiresAt.toISOString(),
    };

    if (messageId) {
      // New format: store in sessions map by messageId
      const existingData = loadFile(path) || {};
      const sessions = existingData.sessions || {};
      sessions[messageId] = sessionData;
      saveFile(path, { sessions });
    } else {
      // Legacy format: single session
      saveFile(path, sessionData);
    }
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
   * Clear all state for a chat (or just one session if messageId provided)
   * @param {ChatId} chatId
   * @param {string} [messageId] - Optional message ID to clear specific session
   * @returns {Promise<void>}
   */
  async clear(chatId, messageId = null) {
    const path = this.#getPath(chatId);
    
    this.#logger.debug('state-store.clear', { chatId: chatId.toString(), messageId });

    if (messageId) {
      // Only clear specific session
      const existingData = loadFile(path) || {};
      if (existingData.sessions && existingData.sessions[messageId]) {
        delete existingData.sessions[messageId];
        saveFile(path, existingData);
      }
    } else {
      // Save empty object to clear all
      saveFile(path, {});
    }
  }

  /**
   * Delete state for a chat (alias for clear)
   * @param {ChatId|string} chatId
   * @param {string} [messageId] - Optional message ID to delete specific session
   * @returns {Promise<void>}
   */
  async delete(chatId, messageId = null) {
    return this.clear(chatId, messageId);
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
