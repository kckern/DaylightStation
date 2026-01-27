/**
 * YamlConversationDatastore - YAML-based conversation persistence
 *
 * Implements IConversationDatastore port for conversation storage.
 * Conversations stored at: households/{hid}/shared/messaging/conversations/{id}.yml
 *
 * @module adapters/persistence/yaml
 */

import path from 'path';
import {
  ensureDir,
  dirExists,
  listYamlFiles,
  listDirs,
  loadYamlSafe,
  saveYaml,
  deleteYaml
} from '#system/utils/FileIO.mjs';
import { IConversationDatastore } from '#apps/shared/ports/IConversationDatastore.mjs';

export class YamlConversationDatastore extends IConversationDatastore {
  #userDataService;
  #logger;

  /**
   * @param {Object} config
   * @param {Object} config.userDataService - UserDataService instance for YAML I/O
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    super();
    if (!config.userDataService) {
      throw new Error('YamlConversationDatastore requires userDataService');
    }
    this.#userDataService = config.userDataService;
    this.#logger = config.logger || console;
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get conversations directory path
   * @private
   */
  #getConversationsDir(householdId) {
    return this.#userDataService.getHouseholdSharedPath(householdId, 'messaging/conversations');
  }

  /**
   * Get conversation file path
   * @private
   */
  #getConversationPath(householdId, conversationId) {
    const dir = this.#getConversationsDir(householdId);
    return path.join(dir, conversationId);
  }

  /**
   * Ensure conversations directory exists
   * @private
   */
  #ensureDir(householdId) {
    const dir = this.#getConversationsDir(householdId);
    if (dir) ensureDir(dir);
    return dir;
  }

  /**
   * Read a conversation file
   * @private
   */
  #readFile(basePath) {
    return loadYamlSafe(basePath);
  }

  /**
   * Extract household ID from conversation ID or metadata
   * @private
   */
  #extractHouseholdId(conversation) {
    // Check metadata first
    if (conversation.metadata?.householdId) {
      return conversation.metadata.householdId;
    }
    // Check participants for household context
    if (conversation.participants?.length > 0) {
      // Participants might include household ID prefix
      for (const p of conversation.participants) {
        if (typeof p === 'string' && p.includes(':')) {
          const [prefix] = p.split(':');
          if (prefix !== 'telegram' && prefix !== 'email') {
            return prefix;
          }
        }
      }
    }
    return 'default';
  }

  // ===========================================================================
  // IConversationStore Implementation
  // ===========================================================================

  /**
   * Save a conversation
   * @param {Object} conversation - Conversation to save
   * @returns {Promise<void>}
   */
  async save(conversation) {
    const data = typeof conversation.toJSON === 'function'
      ? conversation.toJSON()
      : conversation;

    const householdId = this.#extractHouseholdId(data);
    this.#ensureDir(householdId);

    const basePath = this.#getConversationPath(householdId, data.id);
    saveYaml(basePath, data);

    this.#logger.debug?.('conversation.saved', {
      id: data.id,
      householdId
    });
  }

  /**
   * Find conversation by ID
   * @param {string} id - Conversation ID
   * @returns {Promise<Object|null>}
   */
  async findById(id) {
    // Try default household first
    const defaultHouseholdId = 'default';
    let filePath = this.#getConversationPath(defaultHouseholdId, id);
    let data = this.#readFile(filePath);
    if (data) return data;

    // Try to find in any household directory
    const dataRoot = this.#userDataService.getDataRoot?.();
    if (dataRoot) {
      const householdsDir = path.join(dataRoot, 'households');
      if (dirExists(householdsDir)) {
        const households = listDirs(householdsDir);
        for (const hid of households) {
          filePath = this.#getConversationPath(hid, id);
          data = this.#readFile(filePath);
          if (data) return data;
        }
      }
    }

    return null;
  }

  /**
   * Find conversation by participants (exact match)
   * @param {string[]} participants - Participant IDs
   * @returns {Promise<Object|null>}
   */
  async findByParticipants(participants) {
    const sortedTarget = [...participants].sort();
    const conversations = await this.#getAllConversations();

    for (const conv of conversations) {
      const sortedParticipants = [...(conv.participants || [])].sort();
      if (sortedParticipants.length === sortedTarget.length &&
          sortedParticipants.every((p, i) => p === sortedTarget[i])) {
        return conv;
      }
    }

    return null;
  }

  /**
   * Find conversations for a participant
   * @param {string} participantId - Participant ID
   * @returns {Promise<Object[]>}
   */
  async findByParticipant(participantId) {
    const conversations = await this.#getAllConversations();
    return conversations.filter(conv =>
      (conv.participants || []).includes(participantId)
    );
  }

  /**
   * Find active conversations (recent messages within threshold)
   * @param {number} thresholdMinutes - Activity threshold in minutes
   * @returns {Promise<Object[]>}
   */
  async findActive(thresholdMinutes) {
    const conversations = await this.#getAllConversations();
    const threshold = Date.now() - (thresholdMinutes * 60 * 1000);

    return conversations.filter(conv => {
      const lastMessage = conv.lastMessageAt || conv.startedAt;
      return lastMessage && new Date(lastMessage).getTime() > threshold;
    });
  }

  /**
   * Delete a conversation
   * @param {string} id - Conversation ID
   * @returns {Promise<void>}
   */
  async delete(id) {
    // Find the conversation first to get household
    const conversation = await this.findById(id);
    if (!conversation) return;

    const householdId = this.#extractHouseholdId(conversation);
    const basePath = this.#getConversationPath(householdId, id);
    deleteYaml(basePath);

    this.#logger.debug?.('conversation.deleted', { id, householdId });
  }

  // ===========================================================================
  // Helper Methods
  // ===========================================================================

  /**
   * Get all conversations from all households
   * @private
   */
  async #getAllConversations() {
    const conversations = [];
    const dataRoot = this.#userDataService.getDataRoot?.();

    if (!dataRoot) {
      return conversations;
    }

    const householdsDir = path.join(dataRoot, 'households');
    if (!dirExists(householdsDir)) {
      return conversations;
    }

    const households = listDirs(householdsDir);
    for (const hid of households) {
      const convDir = this.#getConversationsDir(hid);
      if (!convDir || !dirExists(convDir)) continue;

      const baseNames = listYamlFiles(convDir);

      for (const baseName of baseNames) {
        const conv = loadYamlSafe(path.join(convDir, baseName));
        if (conv) {
          conversations.push(conv);
        }
      }
    }

    return conversations;
  }

  /**
   * Get conversations for a specific household
   * @param {string} householdId - Household ID
   * @returns {Promise<Object[]>}
   */
  async getConversationsForHousehold(householdId) {
    const convDir = this.#getConversationsDir(householdId);
    if (!convDir || !dirExists(convDir)) {
      return [];
    }

    const baseNames = listYamlFiles(convDir);

    const conversations = [];
    for (const baseName of baseNames) {
      const conv = loadYamlSafe(path.join(convDir, baseName));
      if (conv) {
        conversations.push(conv);
      }
    }

    return conversations;
  }
}

export default YamlConversationDatastore;
