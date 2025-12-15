/**
 * CLI Session Manager
 * @module cli/session/CLISessionManager
 * 
 * Manages conversation state and session persistence for CLI mode.
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * CLI Session Manager
 */
export class CLISessionManager {
  #sessionId;
  #sessionDir;
  #currentBot;
  #debugMode;
  #logger;
  #state;

  /**
   * @param {Object} [options]
   * @param {string} [options.sessionName] - Named session for persistence
   * @param {string} [options.sessionDir] - Directory for session files
   * @param {boolean} [options.debug] - Enable debug logging
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.#sessionId = options.sessionName || `cli-${Date.now()}`;
    this.#sessionDir = options.sessionDir || '/tmp/chatbot-cli/sessions';
    this.#currentBot = null;
    this.#debugMode = options.debug || false;
    // Silent logger unless debug mode or custom logger provided
    this.#logger = options.logger || createLogger({ 
      source: 'cli:session', 
      app: 'cli',
      output: this.#debugMode ? console.log : () => {},
    });
    this.#state = {
      conversationHistory: [],
      botState: {},
    };
  }

  // ==================== Session Lifecycle ====================

  /**
   * Initialize the session
   */
  async initialize() {
    try {
      await fs.mkdir(this.#sessionDir, { recursive: true });
      
      // Try to load existing session
      const sessionFile = this.#getSessionFilePath();
      try {
        const data = await fs.readFile(sessionFile, 'utf8');
        const saved = JSON.parse(data);
        
        this.#state = saved.state || this.#state;
        this.#currentBot = saved.currentBot;
        this.#debugMode = saved.debugMode ?? this.#debugMode;
        
        this.#logger.info('session.loaded', { sessionId: this.#sessionId, bot: this.#currentBot });
      } catch {
        // No existing session, start fresh
        this.#logger.info('session.created', { sessionId: this.#sessionId });
      }
    } catch (error) {
      this.#logger.error('session.initError', { error: error.message });
      throw error;
    }
  }

  /**
   * Persist the current session state
   */
  async persist() {
    try {
      const sessionFile = this.#getSessionFilePath();
      const data = {
        sessionId: this.#sessionId,
        currentBot: this.#currentBot,
        debugMode: this.#debugMode,
        state: this.#state,
        savedAt: new Date().toISOString(),
      };
      
      await fs.writeFile(sessionFile, JSON.stringify(data, null, 2));
      this.#logger.debug('session.persisted', { sessionId: this.#sessionId });
    } catch (error) {
      this.#logger.error('session.persistError', { error: error.message });
    }
  }

  /**
   * Clear the current session state
   */
  async clear() {
    this.#state = {
      conversationHistory: [],
      botState: {},
    };
    
    try {
      const sessionFile = this.#getSessionFilePath();
      await fs.unlink(sessionFile);
    } catch {
      // File may not exist
    }
    
    this.#logger.info('session.cleared', { sessionId: this.#sessionId });
  }

  // ==================== Accessors ====================

  /**
   * Get the session ID
   */
  getSessionId() {
    return this.#sessionId;
  }

  /**
   * Get the conversation ID for the current bot
   */
  getConversationId() {
    return `cli:${this.#currentBot || 'unknown'}:${this.#sessionId}`;
  }

  /**
   * Get the user ID
   */
  getUserId() {
    return 'cli-user';
  }

  /**
   * Get the current bot name
   */
  getCurrentBot() {
    return this.#currentBot;
  }

  /**
   * Set the current bot
   * @param {string} botName
   */
  setCurrentBot(botName) {
    this.#currentBot = botName;
    this.#logger.info('session.botChanged', { bot: botName });
  }

  /**
   * Check if debug mode is enabled
   */
  isDebugMode() {
    return this.#debugMode;
  }

  /**
   * Toggle debug mode
   */
  toggleDebugMode() {
    this.#debugMode = !this.#debugMode;
    this.#logger.info('session.debugToggled', { debug: this.#debugMode });
    return this.#debugMode;
  }

  // ==================== Conversation History ====================

  /**
   * Add a message to conversation history
   * @param {Object} message
   */
  addToHistory(message) {
    this.#state.conversationHistory.push({
      ...message,
      timestamp: new Date().toISOString(),
    });
    
    // Keep only last 100 messages
    if (this.#state.conversationHistory.length > 100) {
      this.#state.conversationHistory = this.#state.conversationHistory.slice(-100);
    }
  }

  /**
   * Get conversation history
   * @param {number} [limit=50]
   */
  getHistory(limit = 50) {
    return this.#state.conversationHistory.slice(-limit);
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.#state.conversationHistory = [];
    this.#logger.info('session.historyCleared');
  }

  // ==================== Bot State ====================

  /**
   * Get state for current bot
   */
  getBotState() {
    return this.#state.botState[this.#currentBot] || {};
  }

  /**
   * Set state for current bot
   * @param {Object} state
   */
  setBotState(state) {
    this.#state.botState[this.#currentBot] = state;
  }

  /**
   * Update bot state (merge)
   * @param {Object} updates
   */
  updateBotState(updates) {
    this.#state.botState[this.#currentBot] = {
      ...this.getBotState(),
      ...updates,
    };
  }

  // ==================== Pending Log Tracking ====================

  /**
   * Add a pending log UUID
   * @param {string} logUuid
   */
  addPendingLogUuid(logUuid) {
    const state = this.getBotState();
    const pending = state.pendingLogUuids || [];
    if (!pending.includes(logUuid)) {
      pending.push(logUuid);
    }
    this.updateBotState({ pendingLogUuids: pending });
  }

  /**
   * Remove a pending log UUID
   * @param {string} logUuid
   */
  removePendingLogUuid(logUuid) {
    const state = this.getBotState();
    const pending = state.pendingLogUuids || [];
    const updated = pending.filter(uuid => uuid !== logUuid);
    this.updateBotState({ pendingLogUuids: updated });
  }

  /**
   * Get all pending log UUIDs
   * @returns {string[]}
   */
  getPendingLogUuids() {
    return this.getBotState().pendingLogUuids || [];
  }

  /**
   * Check if there are pending logs
   * @returns {boolean}
   */
  hasPendingLogs() {
    return this.getPendingLogUuids().length > 0;
  }

  /**
   * Clear all pending log UUIDs
   */
  clearPendingLogUuids() {
    this.updateBotState({ pendingLogUuids: [] });
  }

  /**
   * Set the last pending log UUID (for slash command actions) - DEPRECATED, use addPendingLogUuid
   * @param {string} logUuid
   */
  setLastPendingLogUuid(logUuid) {
    this.addPendingLogUuid(logUuid);
  }

  /**
   * Get the last pending log UUID (most recent)
   * @returns {string|null}
   */
  getLastPendingLogUuid() {
    const pending = this.getPendingLogUuids();
    return pending.length > 0 ? pending[pending.length - 1] : null;
  }

  /**
   * Clear the last pending log UUID - DEPRECATED, use removePendingLogUuid
   */
  clearLastPendingLogUuid() {
    const logUuid = this.getLastPendingLogUuid();
    if (logUuid) {
      this.removePendingLogUuid(logUuid);
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Get the session file path
   * @private
   */
  #getSessionFilePath() {
    return path.join(this.#sessionDir, `${this.#sessionId}.json`);
  }
}

export default CLISessionManager;
