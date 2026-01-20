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

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
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
   * @returns {Promise<Object|null>}
   */
  async #loadFile(conversationId) {
    const filePath = this.#getFilePath(conversationId);
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return yaml.load(content) || null;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Save data to YAML file
   * @private
   */
  async #saveFile(conversationId, data) {
    const filePath = this.#getFilePath(conversationId);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') {
        throw err;
      }
    }

    const yamlContent = yaml.dump(data, { lineWidth: -1 });
    await fs.writeFile(filePath, yamlContent, 'utf8');
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
    const data = await this.#loadFile(conversationId);
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
    let data = await this.#loadFile(conversationId) || {};

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

    await this.#saveFile(conversationId, data);
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
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
      return;
    }

    // Delete specific session
    const data = await this.#loadFile(conversationId);
    if (!data || !data.sessions || !data.sessions[messageId]) {
      return;
    }

    delete data.sessions[messageId];

    // If no sessions left and no root state, delete file
    const { sessions, ...rootState } = data;
    if (Object.keys(sessions).length === 0 && Object.keys(rootState).length === 0) {
      const filePath = this.#getFilePath(conversationId);
      try {
        await fs.unlink(filePath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          throw err;
        }
      }
    } else {
      await this.#saveFile(conversationId, data);
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
