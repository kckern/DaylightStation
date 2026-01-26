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
    if (!config.messagingGateway) throw new Error('messagingGateway is required');
    if (!config.aiGateway) throw new Error('aiGateway is required');
    if (!config.conversationStateStore) throw new Error('conversationStateStore is required');
    if (!config.householdService) throw new Error('householdService is required');

    this.#messagingGateway = config.messagingGateway;
    this.#aiGateway = config.aiGateway;
    this.#conversationStateStore = config.conversationStateStore;
    this.#householdService = config.householdService;
    this.#logger = config.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, conversationId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(conversationId, text, options),
      updateMessage: (msgId, updates) => this.#messagingGateway.updateMessage(conversationId, msgId, updates),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input - Input parameters
   * @param {string} input.conversationId - Conversation ID
   * @param {string} [input.text] - Text input from user
   * @param {string} [input.voiceFileId] - Voice file ID for transcription
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Promise<Object>} Result with extracted items and message ID
   */
  async execute({ conversationId, text, voiceFileId, responseContext }) {
    this.#logger.info?.('processGratitude.start', { conversationId, hasText: !!text, hasVoice: !!voiceFileId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, conversationId);

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
      const { items, category: rawCategory } = await this.#extractItems(inputText);

      // Normalize category - only allow 'gratitude' or 'hopes'
      const category = rawCategory === 'hopes' ? 'hopes' : 'gratitude';

      this.#logger.debug?.('processGratitude.extracted', {
        conversationId,
        itemCount: items.length,
        category,
        rawCategory
      });

      if (items.length === 0) {
        await messaging.sendMessage(
          "I couldn't identify any gratitude items from your input. Could you try again?"
        );
        return { success: false, error: 'No items extracted' };
      }

      // 3. Get household members for assignment UI
      const members = await this.#householdService?.getMembers?.() || [];

      // 4. Send confirmation UI
      const { messageId } = await this.#sendConfirmationUI(messaging, items, category, members);

      // 5. Save state for callback handling
      await this.#conversationStateStore.set(conversationId, {
        activeFlow: 'gratitude_input',
        flowState: {
          items,
          category,
          confirmationMessageId: messageId,
          originalText: inputText
        }
      }, messageId);

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
   * @param {Object} messaging - Messaging interface
   * @param {Array} items - Extracted items
   * @param {string} category - Category
   * @param {Array} members - Household members
   * @returns {Promise<Object>} Result with messageId
   */
  async #sendConfirmationUI(messaging, items, category, members) {
    // Build message text (legacy format with HTML)
    const itemsList = items.map(item => `• ${item.text}`).join('\n');
    const categoryLabel = category === 'gratitude' ? 'grateful' : 'hoping';
    const messageText = `📝 <b>Items to Add</b>\n\n${itemsList}\n\n<i>Who is ${categoryLabel} for these?</i>`;

    // Build keyboard matching legacy pattern
    const choices = [];

    // Row 1: Category toggle (both options, ✅ on selected)
    choices.push([
      {
        label: category === 'gratitude' ? '✅ Gratitude' : 'Gratitude',
        data: 'category:gratitude'
      },
      {
        label: category === 'hopes' ? '✅ Hopes' : 'Hopes',
        data: 'category:hopes'
      }
    ]);

    // Member rows (3 per row, no emoji, use displayName)
    const memberButtons = members.map(member => ({
      label: member.groupLabel || member.displayName || member.userId,
      data: `user:${member.userId}`
    }));

    for (let i = 0; i < memberButtons.length; i += 3) {
      choices.push(memberButtons.slice(i, i + 3));
    }

    // Last row: Cancel only (clicking user assigns directly)
    choices.push([{ label: '❌ Cancel', data: 'cancel' }]);

    const result = await messaging.sendMessage(
      messageText,
      { choices, inline: true, parseMode: 'HTML' }
    );

    return { messageId: result.messageId };
  }
}

export default ProcessGratitudeInput;
