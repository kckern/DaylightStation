/**
 * ProcessGratitudeInput Use Case
 * @module homebot/usecases/ProcessGratitudeInput
 *
 * Processes gratitude input from users, extracting items and showing
 * a confirmation UI for review before saving.
 */

import { v4 as uuidv4 } from 'uuid';

/**
 * Process gratitude input use case
 */
export class ProcessGratitudeInput {
  #messagingGateway;
  #aiGateway;
  #conversationStateStore;
  #householdService;
  #logger;

  /**
   * @param {Object} config - Dependencies
   * @param {Object} config.messagingGateway - Messaging gateway for sending messages
   * @param {Object} config.aiGateway - AI gateway for extracting items
   * @param {Object} config.conversationStateStore - State store for conversation state
   * @param {Object} config.householdService - Service for household member lookup
   * @param {Object} [config.logger] - Logger instance
   */
  constructor(config) {
    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdService = config.householdService;
    this.#logger = config.logger || console;
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} [input.text] - Text input from user
   * @param {string} [input.voiceFileId] - Voice file ID for transcription
   * @returns {Promise<Object>} Result with extracted items and message ID
   */
  async execute({ conversationId, text, voiceFileId }) {
    this.#logger.info?.('processGratitude.start', { conversationId, hasText: !!text, hasVoice: !!voiceFileId });

    try {
      // 1. Transcribe voice if provided (text takes priority)
      let inputText = text;
      if (!inputText && voiceFileId) {
        inputText = await this.#transcribeVoice(voiceFileId);
      }

      if (!inputText) {
        this.#logger.warn?.('processGratitude.noInput', { conversationId });
        return { success: false, error: 'No input provided' };
      }

      // 2. Extract items using AI
      const { items, category } = await this.#extractItems(inputText);

      this.#logger.debug?.('processGratitude.extracted', {
        conversationId,
        itemCount: items.length,
        category
      });

      if (items.length === 0) {
        await this.#messagingGateway.sendMessage(
          conversationId,
          "I couldn't identify any gratitude items from your input. Could you try again?"
        );
        return { success: false, error: 'No items extracted' };
      }

      // 3. Get household members for assignment UI
      const members = await this.#householdService?.getMembers?.() || [];

      // 4. Send confirmation UI
      const { messageId } = await this.#sendConfirmationUI(conversationId, items, category, members);

      // 5. Save state for callback handling
      const stateKey = `gratitude:${conversationId}`;
      await this.#conversationStateStore?.set?.(stateKey, {
        items,
        category,
        messageId,
        createdAt: Date.now()
      });

      this.#logger.info?.('processGratitude.complete', {
        conversationId,
        itemCount: items.length,
        messageId
      });

      return {
        success: true,
        items,
        category,
        messageId
      };
    } catch (error) {
      this.#logger.error?.('processGratitude.error', { conversationId, error: error.message });
      throw error;
    }
  }

  /**
   * Transcribe voice input
   * @private
   * @param {string} voiceFileId - Voice file ID
   * @returns {Promise<string>} Transcribed text
   */
  async #transcribeVoice(voiceFileId) {
    // Voice transcription would be handled by the AI gateway
    // For now, return empty if no transcription capability
    this.#logger.debug?.('processGratitude.transcribe', { voiceFileId });
    if (this.#aiGateway?.transcribe) {
      return await this.#aiGateway.transcribe(voiceFileId);
    }
    return '';
  }

  /**
   * Extract gratitude items from text using AI
   * @private
   * @param {string} text - User input text
   * @returns {Promise<Object>} Extracted items and category
   */
  async #extractItems(text) {
    try {
      const prompt = [
        {
          role: 'system',
          content: `You are a gratitude assistant. Extract individual gratitude items from user input.
Return JSON with:
- items: Array of { text: string } representing each distinct thing the user is grateful for
- category: One of "gratitude", "accomplishment", "blessing", "appreciation"

Be generous in parsing - even simple phrases like "my family" should be extracted.
Split compound statements (e.g., "family and health" -> two items).
Preserve the user's wording but clean up grammar if needed.

Example input: "I'm grateful for good health and my supportive family"
Example output: { "items": [{ "text": "Good health" }, { "text": "Supportive family" }], "category": "gratitude" }`
        },
        {
          role: 'user',
          content: text
        }
      ];

      const result = await this.#aiGateway.chatWithJson(prompt);

      // Ensure items have IDs
      const items = (result?.items || []).map(item => ({
        id: uuidv4(),
        text: item.text || item.content || String(item)
      }));

      return {
        items,
        category: result?.category || 'gratitude'
      };
    } catch (error) {
      this.#logger.warn?.('processGratitude.aiError', { error: error.message });
      // Fallback: simple comma/newline split
      return this.#fallbackExtraction(text);
    }
  }

  /**
   * Fallback extraction when AI fails
   * @private
   * @param {string} text - User input text
   * @returns {Object} Extracted items and category
   */
  #fallbackExtraction(text) {
    // Split on commas, "and", or newlines
    const delimiters = /[,\n]|\s+and\s+/gi;
    const rawItems = text.split(delimiters)
      .map(s => s.trim())
      .filter(s => s.length > 0)
      // Remove common prefixes
      .map(s => s.replace(/^(i'?m\s+)?(grateful|thankful)\s+(for\s+)?/i, '').trim())
      .filter(s => s.length > 0);

    const items = rawItems.map(text => ({
      id: uuidv4(),
      text: text.charAt(0).toUpperCase() + text.slice(1)
    }));

    return {
      items,
      category: 'gratitude'
    };
  }

  /**
   * Send confirmation UI with items and action buttons
   * @private
   * @param {string} conversationId - Conversation ID
   * @param {Array} items - Extracted items
   * @param {string} category - Category
   * @param {Array} members - Household members
   * @returns {Promise<Object>} Result with messageId
   */
  async #sendConfirmationUI(conversationId, items, category, members) {
    // Build message text
    const itemsList = items
      .map((item, index) => `${index + 1}. ${item.text}`)
      .join('\n');

    const messageText = `I found these ${category} items:\n\n${itemsList}\n\nWho should these be attributed to?`;

    // Build member selection buttons
    const memberButtons = members.slice(0, 4).map(member => ({
      text: member.displayName || member.username,
      callback_data: JSON.stringify({ cmd: 'assign', user: member.username })
    }));

    // Build action buttons
    const actionButtons = [
      { text: 'Confirm All', callback_data: JSON.stringify({ cmd: 'confirm' }) },
      { text: 'Cancel', callback_data: JSON.stringify({ cmd: 'cancel' }) }
    ];

    const keyboard = [];
    if (memberButtons.length > 0) {
      keyboard.push(memberButtons);
    }
    keyboard.push(actionButtons);

    const result = await this.#messagingGateway.sendMessage(
      conversationId,
      messageText,
      { choices: keyboard, inline: true }
    );

    return { messageId: result.messageId };
  }
}

export default ProcessGratitudeInput;
