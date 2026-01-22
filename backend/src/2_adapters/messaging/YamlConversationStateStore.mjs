/**
 * YamlConversationStateStore - YAML-based conversation state persistence
 *
 * Implements IConversationStateStore port for multi-turn conversation state.
 * Supports message-keyed sessions for complex flows.
 *
 * Storage format:
 *   {basePath}/{conversationId}.yml
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
} from '../../0_infrastructure/utils/FileIO.mjs';
import { IConversationStateStore } from '../../1_domains/messaging/ports/IConversationStateStore.mjs';

export class YamlConversationStateStore extends IConversationStateStore {
  #basePath;

  /**
   * @param {Object} config
   * @param {string} config.basePath - Directory for state files
   */
  constructor(config) {
    super();
    if (!config?.basePath) {
      throw new Error('YamlConversationStateStore requires basePath');
    }
    this.#basePath = config.basePath;
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
   * Get file path for a conversation
   * @private
   */
  #getFilePath(conversationId) {
    const safeId = this.#sanitizeId(conversationId);
    return path.join(this.#basePath, `${safeId}.yml`);
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
      updatedAt: new Date().toISOString()
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

export default YamlConversationStateStore;
