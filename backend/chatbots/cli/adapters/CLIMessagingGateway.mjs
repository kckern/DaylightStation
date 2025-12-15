/**
 * CLI Messaging Gateway
 * @module cli/adapters/CLIMessagingGateway
 * 
 * Implements IMessagingGateway for CLI terminal output.
 * This adapter allows chatbots to communicate through the terminal
 * instead of Telegram or other messaging platforms.
 * 
 * Button System:
 * - Buttons are displayed inline with IDs: [1] Accept  [2] Revise  [3] Discard
 * - IDs cycle: 1-9, 0, A-Z (36 total), then back to 1
 * - Single character input triggers button press on most recent matching ID
 * - Pressing any button clears that message's entire button set (like Telegram)
 */

import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../_lib/logging/index.mjs';

// Button ID sequence: 1-9, 0, A-Z
const BUTTON_IDS = '1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/**
 * CLI Messaging Gateway - implements IMessagingGateway for terminal
 */
export class CLIMessagingGateway {
  #presenter;
  #inputHandler;
  #imageHandler;
  #logger;
  #messageCounter;
  #messages; // Store messages for reference
  #testMode; // Non-interactive mode for testing
  #autoSelectIndex; // Which choice to auto-select in test mode
  
  // Button registry: Map<buttonId, { messageId, callbackData, label }>
  #buttonRegistry;
  #nextButtonIndex;

  /**
   * @param {Object} deps
   * @param {import('../presenters/CLIPresenter.mjs').CLIPresenter} deps.presenter
   * @param {import('../input/CLIInputHandler.mjs').CLIInputHandler} deps.inputHandler
   * @param {import('../media/CLIImageHandler.mjs').CLIImageHandler} [deps.imageHandler]
   * @param {boolean} [deps.testMode=false] - Non-interactive mode for testing
   * @param {Object} [deps.logger]
   */
  constructor(deps) {
    if (!deps.presenter) throw new Error('presenter is required');
    if (!deps.inputHandler) throw new Error('inputHandler is required');

    this.#presenter = deps.presenter;
    this.#inputHandler = deps.inputHandler;
    this.#imageHandler = deps.imageHandler;
    this.#logger = deps.logger || createLogger({ source: 'cli:messaging', app: 'cli' });
    this.#messageCounter = 0;
    this.#messages = new Map();
    this.#testMode = deps.testMode || false;
    this.#autoSelectIndex = 0;
    
    // Button system
    this.#buttonRegistry = new Map();
    this.#nextButtonIndex = 0;
  }

  /**
   * Enable test mode (non-interactive)
   * @param {boolean} enabled
   */
  setTestMode(enabled) {
    this.#testMode = enabled;
  }

  /**
   * Set which choice index to auto-select in test mode
   * @param {number} index
   */
  setAutoSelectIndex(index) {
    this.#autoSelectIndex = index;
  }

  // ==================== Button System ====================

  /**
   * Get the next button ID
   * @private
   */
  #getNextButtonId() {
    const id = BUTTON_IDS[this.#nextButtonIndex % BUTTON_IDS.length];
    this.#nextButtonIndex++;
    return id;
  }

  /**
   * Register buttons for a message (non-blocking)
   * @private
   * @param {string} messageId
   * @param {Array} choices - 2D array of button objects
   * @returns {Array} - Array of { id, label, callbackData }
   */
  #registerButtons(messageId, choices) {
    const registeredButtons = [];
    const flatChoices = choices.flat();
    
    for (const choice of flatChoices) {
      const buttonId = this.#getNextButtonId();
      const callbackData = choice.callback_data || choice.text || choice;
      const label = choice.text || choice;
      
      this.#buttonRegistry.set(buttonId, {
        messageId,
        callbackData,
        label,
      });
      
      registeredButtons.push({ id: buttonId, label, callbackData });
    }
    
    // Store button IDs with the message for clearing later
    const msg = this.#messages.get(messageId);
    if (msg) {
      msg.buttonIds = registeredButtons.map(b => b.id);
      this.#messages.set(messageId, msg);
    }
    
    return registeredButtons;
  }

  /**
   * Clear all buttons for a message
   * @private
   * @param {string} messageId
   */
  #clearButtonsForMessage(messageId) {
    const msg = this.#messages.get(messageId);
    if (msg?.buttonIds) {
      for (const buttonId of msg.buttonIds) {
        this.#buttonRegistry.delete(buttonId);
      }
      msg.buttonIds = [];
      this.#messages.set(messageId, msg);
    }
  }

  /**
   * Check if a string is a button press (single alphanumeric char)
   * @param {string} input
   * @returns {boolean}
   */
  isButtonPress(input) {
    if (!input || input.length !== 1) return false;
    const upper = input.toUpperCase();
    return BUTTON_IDS.includes(upper);
  }

  /**
   * Execute a button press by ID
   * @param {string} buttonId - Single character button ID (1-9, 0, A-Z)
   * @returns {{ success: boolean, callbackData: string|null, messageId: string|null }}
   */
  pressButton(buttonId) {
    const upper = buttonId.toUpperCase();
    const button = this.#buttonRegistry.get(upper);
    
    if (!button) {
      this.#logger.debug('pressButton.notFound', { buttonId: upper });
      return { success: false, callbackData: null, messageId: null };
    }
    
    const { messageId, callbackData, label } = button;
    
    // Clear all buttons for this message (Telegram-style)
    this.#clearButtonsForMessage(messageId);
    
    this.#logger.debug('pressButton.executed', { buttonId: upper, callbackData, messageId });
    
    // Store for getLastCallbackData() compatibility
    this.#lastCallbackData = callbackData;
    
    return { success: true, callbackData, messageId };
  }

  /**
   * Get all active buttons (for display/debugging)
   * @returns {Array<{ id: string, label: string, callbackData: string }>}
   */
  getActiveButtons() {
    const buttons = [];
    for (const [id, data] of this.#buttonRegistry) {
      buttons.push({ id, label: data.label, callbackData: data.callbackData });
    }
    return buttons;
  }

  /**
   * Check if there are any pending buttons
   * @returns {boolean}
   */
  hasPendingButtons() {
    return this.#buttonRegistry.size > 0;
  }

  // ==================== Core Messaging ====================

  /**
   * Send a text message
   * @param {string} conversationId
   * @param {string} text
   * @param {Object} [options]
   * @param {Array} [options.choices] - Inline keyboard buttons (2D array)
   * @param {boolean} [options.inline] - Whether to show inline keyboard
   * @param {string} [options.parseMode] - 'HTML' or 'Markdown'
   * @param {Object} [options.attachment] - If present, this is a photo message (already displayed)
   * @param {boolean} [options.skipDisplay] - Skip displaying the message (for registering buttons only)
   * @param {string} [options.messageType] - Type tag for message (e.g., 'report', 'adjustment')
   * @returns {Promise<{ messageId: string }>}
   */
  async sendMessage(conversationId, text, options = {}) {
    const messageId = this.#generateMessageId();
    
    this.#logger.debug('sendMessage', { conversationId, messageId, hasChoices: !!options.choices, hasAttachment: !!options.attachment, testMode: this.#testMode, messageType: options.messageType });

    // Store message for potential updates
    this.#messages.set(messageId, { 
      text, 
      options, 
      conversationId, 
      buttonIds: [],
      messageType: options.messageType || null,
    });

    // Skip display if:
    // - Test mode (to reduce noise)
    // - Has attachment (photo message already displayed via printPhotoMessage)
    // - Explicitly skipped
    const shouldDisplay = !this.#testMode && !options.attachment && !options.skipDisplay && text;
    
    if (shouldDisplay) {
      // Show message ID for tracking
      this.#presenter.printSystemMessage(`[Message ${messageId}]`);
      this.#presenter.printBotMessage(text, {
        botName: this.#getBotNameFromConversation(conversationId),
        emoji: this.#getBotEmoji(conversationId),
      });
    } else if (!this.#testMode && options.attachment) {
      // For photo messages, just note the message ID (image already displayed)
      this.#presenter.printSystemMessage(`[Message ${messageId} - photo]`);
    }

    // Handle inline keyboard choices (non-blocking)
    if (options.choices && options.choices.length > 0) {
      if (this.#testMode) {
        // In test mode, auto-select based on configured index
        const flatChoices = options.choices.flat();
        if (flatChoices.length > 0) {
          const choice = flatChoices[Math.min(this.#autoSelectIndex, flatChoices.length - 1)];
          this.#lastCallbackData = choice.callback_data || choice.text || choice;
          this.#logger.debug('sendMessage.autoSelected', { messageId, selected: this.#lastCallbackData });
        }
      } else {
        // Register buttons (non-blocking) and display them
        const buttons = this.#registerButtons(messageId, options.choices);
        this.#presenter.printButtonBar(buttons);
      }
    }

    return { messageId };
  }

  /**
   * Update an existing message
   * @param {string} conversationId
   * @param {string} messageId
   * @param {Object} options
   * @param {string} [options.text]
   * @param {Array} [options.choices]
   * @returns {Promise<{}>}
   */
  async updateMessage(conversationId, messageId, options = {}) {
    this.#logger.debug('updateMessage', { conversationId, messageId, hasText: !!options.text, hasChoices: !!options.choices, testMode: this.#testMode });

    const existingMessage = this.#messages.get(messageId);
    
    // Clear any existing buttons for this message before update
    this.#clearButtonsForMessage(messageId);
    
    // Build update description
    const updates = [];
    if (options.text && options.text !== existingMessage?.text) updates.push('caption');
    if (options.choices) updates.push('buttons');
    const updateDesc = updates.length > 0 ? ` (${updates.join(', ')})` : '';
    
    // In terminal, we can't truly update - just print a new version (skip in test mode)
    if (!this.#testMode) {
      this.#presenter.printSystemMessage(`[Message ${messageId} updated${updateDesc}]`);
      
      if (options.text && options.text !== existingMessage?.text) {
        this.#presenter.printBotMessage(options.text, {
          botName: this.#getBotNameFromConversation(conversationId),
          emoji: this.#getBotEmoji(conversationId),
        });
      }
    }

    // Handle choices in update (non-blocking)
    if (options.choices && options.choices.length > 0) {
      if (this.#testMode) {
        // In test mode, auto-select based on configured index
        const flatChoices = options.choices.flat();
        if (flatChoices.length > 0) {
          const choice = flatChoices[Math.min(this.#autoSelectIndex, flatChoices.length - 1)];
          this.#lastCallbackData = choice.callback_data || choice.text || choice;
        }
      } else {
        // Register buttons (non-blocking) and display them
        const buttons = this.#registerButtons(messageId, options.choices);
        this.#presenter.printButtonBar(buttons);
      }
    }

    // Update stored message
    if (existingMessage) {
      this.#messages.set(messageId, { ...existingMessage, ...options, buttonIds: existingMessage.buttonIds });
    }

    return {};
  }

  /**
   * Delete a message
   * @param {string} conversationId
   * @param {string} messageId
   * @returns {Promise<{}>}
   */
  async deleteMessage(conversationId, messageId) {
    this.#logger.debug('deleteMessage', { conversationId, messageId });
    
    // Clear any buttons for this message
    this.#clearButtonsForMessage(messageId);
    
    // In terminal, we can't delete - just note it (skip in test mode)
    if (!this.#testMode) {
      this.#presenter.printSystemMessage(`[Message ${messageId} deleted]`);
    }
    
    this.#messages.delete(messageId);
    
    return {};
  }

  /**
   * Find messages by type
   * @param {string} conversationId
   * @param {string} messageType - e.g., 'report', 'adjustment', etc.
   * @returns {Array<{ messageId: string, text: string }>}
   */
  findMessagesByType(conversationId, messageType) {
    const results = [];
    for (const [messageId, data] of this.#messages) {
      if (data.conversationId === conversationId && data.messageType === messageType) {
        results.push({ messageId, text: data.text });
      }
    }
    return results;
  }

  /**
   * Delete all messages of a specific type
   * @param {string} conversationId
   * @param {string} messageType
   * @returns {Promise<number>} - Number of messages deleted
   */
  async deleteMessagesByType(conversationId, messageType) {
    const toDelete = this.findMessagesByType(conversationId, messageType);
    for (const { messageId } of toDelete) {
      await this.deleteMessage(conversationId, messageId);
    }
    this.#logger.debug('deleteMessagesByType', { conversationId, messageType, count: toDelete.length });
    return toDelete.length;
  }

  // ==================== Media ====================

  /**
   * Send a photo
   * @param {string} conversationId
   * @param {string|Buffer} photo - URL, file path, or Buffer
   * @param {Object} [options]
   * @param {string} [options.caption]
   * @param {Array} [options.choices]
   * @returns {Promise<{ messageId: string }>}
   */
  async sendPhoto(conversationId, photo, options = {}) {
    const messageId = this.#generateMessageId();
    
    this.#logger.debug('sendPhoto', { conversationId, messageId, hasCaption: !!options.caption, hasChoices: !!options.choices });

    let savedPath = null;

    try {
      // Save the image to /tmp
      if (this.#imageHandler) {
        if (Buffer.isBuffer(photo)) {
          savedPath = await this.#imageHandler.saveBuffer(photo, 'image.png');
        } else if (typeof photo === 'string') {
          if (photo.startsWith('data:image/')) {
            // Base64 data URL - extract and save
            const matches = photo.match(/^data:image\/(\w+);base64,(.+)$/);
            if (matches) {
              const [, ext, base64Data] = matches;
              savedPath = await this.#imageHandler.saveBase64(base64Data, `image/${ext}`);
            }
          } else if (photo.startsWith('http')) {
            savedPath = await this.#imageHandler.downloadImage(photo);
          } else {
            // Local file path - copy to tmp
            savedPath = await this.#imageHandler.copyFile(photo);
          }
        }
      }

      // Store message for potential updates
      this.#messages.set(messageId, { 
        text: options.caption || '', 
        options, 
        conversationId, 
        buttonIds: [],
        imagePath: savedPath,
      });

      if (!this.#testMode) {
        // Use the standard photo message format with ASCII art frame
        this.#presenter.printPhotoMessage({
          caption: options.caption || '',
          emoji: '📷',
          botName: this.#getBotNameFromConversation(conversationId),
          botEmoji: this.#getBotEmoji(conversationId),
          filePath: savedPath || photo,
        });

        this.#presenter.printSystemMessage(`[Message ${messageId} - photo]`);
      }

      // Handle choices (non-blocking button registration, same as sendMessage)
      if (options.choices && options.choices.length > 0) {
        if (this.#testMode) {
          // In test mode, auto-select based on configured index
          const flatChoices = options.choices.flat();
          if (flatChoices.length > 0) {
            const choice = flatChoices[Math.min(this.#autoSelectIndex, flatChoices.length - 1)];
            this.#lastCallbackData = choice.callback_data || choice.text || choice;
            this.#logger.debug('sendPhoto.autoSelected', { messageId, selected: this.#lastCallbackData });
          }
        } else {
          // Register buttons (non-blocking) and display them
          const buttons = this.#registerButtons(messageId, options.choices);
          this.#presenter.printButtonBar(buttons);
        }
      }
    } catch (error) {
      this.#logger.error('sendPhoto.error', { error: error.message });
      this.#presenter.printError(`Failed to save image: ${error.message}`);
    }

    return { messageId, imagePath: savedPath };
  }

  /**
   * Get file URL (for CLI, returns local path or mock URL)
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async getFileUrl(fileId) {
    this.#logger.debug('getFileUrl', { fileId });
    
    // If fileId is already a path, return it
    if (fileId.startsWith('/') || fileId.startsWith('./')) {
      return fileId;
    }

    // Return mock URL
    return `file://${fileId}`;
  }

  // ==================== Voice ====================

  /**
   * Transcribe voice (in CLI, prompts user for text)
   * @param {string} fileId
   * @returns {Promise<string>}
   */
  async transcribeVoice(fileId) {
    this.#logger.debug('transcribeVoice', { fileId });
    
    this.#presenter.printSystemMessage('Voice message detected. Enter transcription:');
    const text = await this.#inputHandler.promptText('🎤 > ');
    
    return text;
  }

  // ==================== Callback Handling ====================

  /**
   * Last callback data selected (for use cases that expect callbacks)
   * @type {string|null}
   */
  #lastCallbackData = null;

  /**
   * Get the last selected callback data
   * @returns {string|null}
   */
  getLastCallbackData() {
    const data = this.#lastCallbackData;
    this.#lastCallbackData = null;
    return data;
  }

  /**
   * Wait for a callback (inline keyboard selection)
   * This is used when use cases need to wait for button press
   * @param {string} conversationId
   * @param {number} [timeout=300000] - Timeout in ms (5 min default)
   * @returns {Promise<string|null>}
   */
  async waitForCallback(conversationId, timeout = 300000) {
    // In CLI mode, callbacks are handled synchronously during sendMessage
    // This method exists for API compatibility
    return this.#lastCallbackData;
  }

  // ==================== Typing Indicator ====================

  /**
   * Send typing indicator
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async sendTypingIndicator(conversationId) {
    this.#presenter.printThinking('Thinking...');
  }

  /**
   * Clear typing indicator
   * @param {string} conversationId
   * @returns {Promise<void>}
   */
  async clearTypingIndicator(conversationId) {
    this.#presenter.clearThinking();
  }

  // ==================== Private Helpers ====================

  /**
   * Generate a unique message ID
   * @private
   */
  #generateMessageId() {
    return `cli-msg-${++this.#messageCounter}`;
  }

  /**
   * Extract bot name from conversation ID
   * @private
   */
  #getBotNameFromConversation(conversationId) {
    if (conversationId.includes('nutribot')) return 'NutriBot';
    if (conversationId.includes('journalist')) return 'Journalist';
    return 'Bot';
  }

  /**
   * Get bot emoji from conversation ID
   * @private
   */
  #getBotEmoji(conversationId) {
    if (conversationId.includes('nutribot')) return '🍎';
    if (conversationId.includes('journalist')) return '📓';
    return '🤖';
  }
}

export default CLIMessagingGateway;
