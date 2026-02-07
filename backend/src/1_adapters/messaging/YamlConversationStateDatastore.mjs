/**
 * YamlConversationStateDatastore - YAML-based conversation state persistence
 *
 * Implements IConversationStateDatastore port for multi-turn conversation state.
 * Supports message-keyed sessions for complex flows.
 *
 * Storage format:
 *   users/{username}/conversations/{botName}/{conversationId}.yml
 *
 * File structure:
 *   activeFlow: string
 *   flowState: object
 *   updatedAt: ISO timestamp
 *   sessions:
 *     {messageId}:
 *       activeFlow: string
 *       flowState: object
 *       updatedAt: ISO timestamp
 *
 * @module adapters/messaging
 */

import path from 'path';
import {
  ensureDir,
  loadYamlFromPath,
  saveYamlToPath,
  resolveYamlPath,
  deleteFile
} from '#system/utils/FileIO.mjs';
import { nowTs24 } from '#system/utils/index.mjs';
import { IConversationStateDatastore } from '#apps/common/ports/index.mjs';
import { InfrastructureError } from '#system/utils/errors/index.mjs';

export class YamlConversationStateDatastore extends IConversationStateDatastore {
  #userDataService;
  #botName;
  #userResolver;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService for per-user storage
   * @param {string} config.botName - Bot name for path (nutribot, journalist, homebot)
   * @param {Object} config.userResolver - UserResolver for platform ID -> username
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    super();
    if (!config?.userDataService || !config?.botName || !config?.userResolver) {
      throw new InfrastructureError('YamlConversationStateDatastore requires userDataService, botName, userResolver', {
        code: 'MISSING_DEPENDENCY',
        missing: [!config?.userDataService && 'userDataService', !config?.botName && 'botName', !config?.userResolver && 'userResolver'].filter(Boolean)
      });
    }
    this.#userDataService = config.userDataService;
    this.#botName = config.botName;
    this.#userResolver = config.userResolver;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Sanitize conversation ID for use in filename
   * @private
   */
  #sanitizeId(conversationId) {
    return conversationId.replace(/:/g, '_');
  }

  /**
   * Resolve username from conversationId
   * @private
   */
  #resolveUsername(conversationId) {
    // conversationId format: "telegram:{botId}_{userId}" or "telegram:{userId}"
    if (!conversationId?.startsWith('telegram:')) {
      this.#logger.warn?.('conversation.state.unknown_platform', { conversationId });
      return null;
    }
    
    const identifier = conversationId.substring('telegram:'.length);
    // Extract userId (may have botId_ prefix)
    const userId = identifier.includes('_') ? identifier.split('_')[1] : identifier;
    
    const username = this.#userResolver.resolveUser('telegram', userId);
    if (!username) {
      this.#logger.warn?.('conversation.state.user_not_found', { conversationId, userId });
    }
    return username;
  }

  /**
   * Get file path for a conversation
   * @private
   */
  #getFilePath(conversationId) {
    const username = this.#resolveUsername(conversationId);
    if (!username) {
      // Fallback to sanitized ID for unknown users
      const safeId = this.#sanitizeId(conversationId);
      return path.join(this.#userDataService.getUserDir(username || '_unknown'), 'conversations', this.#botName, `${safeId}.yml`);
    }
    
    const safeId = this.#sanitizeId(conversationId);
    return path.join(this.#userDataService.getUserDir(username), 'conversations', this.#botName, `${safeId}.yml`);
  }

  /**
   * Load YAML file for conversation
   * @private
   * @returns {Object|null}
   */
  #loadFile(conversationId) {
    const filePath = this.#getFilePath(conversationId);
    try {
      const basePath = filePath.replace(/\.yml$/, '');
      const resolvedPath = resolveYamlPath(basePath);
      if (!resolvedPath) return null;
      return loadYamlFromPath(resolvedPath) || null;
    } catch (err) {
      return null;
    }
  }

  /**
   * Save data to YAML file
   * @private
   */
  #saveFile(conversationId, data) {
    const filePath = this.#getFilePath(conversationId);
    ensureDir(path.dirname(filePath));
    saveYamlToPath(filePath, data);
  }

  // ===========================================================================
  // IConversationStateStore Implementation
  // ===========================================================================

  /**
   * Get conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional message key for session
   * @returns {Promise<Object|null>}
   */
  async get(conversationId, messageId) {
    const data = this.#loadFile(conversationId);
    if (!data) {
      return null;
    }

    // If message ID provided, return session-specific state
    if (messageId) {
      return data.sessions?.[messageId] || null;
    }

    // Return root state (without sessions)
    const { sessions, ...rootState } = data;
    return Object.keys(rootState).length > 0 ? rootState : null;
  }

  /**
   * Set conversation state
   * @param {string} conversationId
   * @param {Object} state
   * @param {string} [messageId] - Optional message key for session
   */
  async set(conversationId, state, messageId) {
    let data = this.#loadFile(conversationId) || {};

    const stateWithTimestamp = {
      ...state,
      updatedAt: nowTs24()
    };

    if (messageId) {
      // Store under sessions.{messageId}
      if (!data.sessions) {
        data.sessions = {};
      }
      data.sessions[messageId] = stateWithTimestamp;
    } else {
      // Store at root level, preserve sessions
      const existingSessions = data.sessions;
      data = {
        ...stateWithTimestamp
      };
      if (existingSessions) {
        data.sessions = existingSessions;
      }
    }

    this.#saveFile(conversationId, data);
  }

  /**
   * Delete conversation state
   * @param {string} conversationId
   * @param {string} [messageId] - Optional: delete specific session
   */
  async delete(conversationId, messageId) {
    if (!messageId) {
      // Delete entire file
      const filePath = this.#getFilePath(conversationId);
      const basePath = filePath.replace(/\.yml$/, '');

      // Try both extensions
      deleteFile(`${basePath}.yml`);
      deleteFile(`${basePath}.yaml`);
      return;
    }

    // Delete specific session
    const data = this.#loadFile(conversationId);
    if (!data || !data.sessions || !data.sessions[messageId]) {
      return;
    }

    delete data.sessions[messageId];

    // If no sessions left and no root state, delete file
    const { sessions, ...rootState } = data;
    if (Object.keys(sessions).length === 0 && Object.keys(rootState).length === 0) {
      const filePath = this.#getFilePath(conversationId);
      const basePath = filePath.replace(/\.yml$/, '');
      deleteFile(`${basePath}.yml`);
      deleteFile(`${basePath}.yaml`);
    } else {
      this.#saveFile(conversationId, data);
    }
  }

  /**
   * Clear all state for a conversation
   * @param {string} conversationId
   */
  async clear(conversationId) {
    await this.delete(conversationId);
  }
}

export default YamlConversationStateDatastore;
