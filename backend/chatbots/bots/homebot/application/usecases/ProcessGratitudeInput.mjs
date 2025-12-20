/**
 * Process Gratitude Input Use Case
 * @module homebot/application/usecases/ProcessGratitudeInput
 * 
 * Extracts gratitude/hope items from text or voice input using AI,
 * then presents a confirmation keyboard for category and user selection.
 */

import { v4 as uuidv4 } from 'uuid';
import { createLogger } from '../../../../_lib/logging/index.mjs';

/**
 * AI prompt for extracting gratitude items
 */
const EXTRACTION_PROMPT = `You are extracting gratitude or hope items from user input.

User input: "{text}"

Extract a list of distinct items the user is grateful for or hoping for.
Clean up grammar and format each as Title Case (2-5 words max per item).
If the input doesn't contain gratitude/hope items, return an empty array.

Also determine if these are primarily:
- "gratitude": Things they're thankful for (past/present) - e.g., "sunny weather", "good health", "family"
- "hopes": Things they wish for (future) - e.g., "good grades", "new job", "vacation"

Return ONLY a valid JSON object with "items" array and "category" string, no explanation.

Example:
Input: "sunny weather today, my morning coffee was great, and spending time with family"
Output: {"items": ["Sunny Weather", "Morning Coffee", "Family Time"], "category": "gratitude"}

Input: "I hope to get good grades and find a nice apartment"
Output: {"items": ["Good Grades", "Nice Apartment"], "category": "hopes"}

Input: "hello how are you"
Output: {"items": [], "category": "gratitude"}`;

/**
 * Process Gratitude Input Use Case
 */
export class ProcessGratitudeInput {
  #messagingGateway;
  #aiGateway;
  #householdRepository;
  #conversationStateStore;
  #config;
  #logger;

  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#householdRepository = deps.householdRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#config = deps.config;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'homebot' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.userId - Telegram user ID
   * @param {string} input.conversationId - Chat ID
   * @param {string} [input.text] - Text input
   * @param {string} [input.voiceFileId] - Voice file ID for transcription
   * @param {string} [input.messageId] - Original message ID to delete
   */
  async execute(input) {
    const { userId, conversationId, text, voiceFileId, messageId } = input;

    this.#logger.info('processGratitudeInput.start', { 
      conversationId, 
      hasText: !!text, 
      hasVoice: !!voiceFileId 
    });

    try {
      // 1. Delete original message (if we can)
      if (messageId && this.#messagingGateway) {
        try {
          await this.#messagingGateway.deleteMessage(conversationId, messageId);
        } catch (e) {
          this.#logger.debug('processGratitudeInput.deleteMessage.skipped', { error: e.message });
        }
      }

      // 2. Send processing status
      let statusMsg;
      try {
        statusMsg = await this.#messagingGateway.sendMessage(conversationId, 
          '🔄 Processing your gratitude items...'
        );
      } catch (e) {
        this.#logger.error('processGratitudeInput.sendStatus.failed', { error: e.message });
        throw e;
      }

      // 3. Get text (transcribe if voice)
      let inputText = text;
      if (voiceFileId && !inputText) {
        inputText = await this.#transcribeVoice(voiceFileId);
        this.#logger.debug('processGratitudeInput.transcribed', { 
          voiceFileId, 
          textLength: inputText?.length 
        });
      }

      if (!inputText?.trim()) {
        await this.#updateStatus(conversationId, statusMsg?.message_id, 
          '❌ Could not understand input. Please try again with text or voice.');
        return;
      }

      // 4. Extract items and suggested category via AI
      const { items, category: suggestedCategory } = await this.#extractItems(inputText);

      if (!items || items.length === 0) {
        await this.#updateStatus(conversationId, statusMsg?.messageId,
          '❌ No gratitude items found. Please describe what you\'re grateful for.\n\n' +
          '<i>Example: "sunny weather, good coffee, family time"</i>',
          'HTML');
        return;
      }

      // 5. Get household members for keyboard
      const members = await this.#getHouseholdMembers();

      if (!members || members.length === 0) {
        await this.#updateStatus(conversationId, statusMsg?.messageId,
          '❌ No household members configured. Please check your household settings.');
        return;
      }

      // 6. Build confirmation message with keyboard (use AI-suggested category as default)
      const defaultCategory = suggestedCategory || 'gratitude';
      const itemsWithIds = items.map(text => ({ id: uuidv4(), text }));
      const keyboard = this.#buildConfirmationKeyboard(members, defaultCategory);
      const messageText = this.#buildConfirmationMessage(items, defaultCategory);

      // 7. Update the processing message with the confirmation
      await this.#messagingGateway.updateMessage(conversationId, statusMsg.messageId, {
        text: messageText,
        parseMode: 'HTML',
        choices: keyboard,
      });

      // 8. Save state for callback handling
      if (this.#conversationStateStore) {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 min expiry
        await this.#conversationStateStore.set(conversationId, {
          activeFlow: 'gratitude_input',
          flowState: {
            items: itemsWithIds,
            category: defaultCategory,
            confirmationMessageId: statusMsg.messageId,
            originalText: inputText,
          },
          updatedAt: now,
          expiresAt: expiresAt,
        });
      }

      this.#logger.info('processGratitudeInput.complete', { 
        conversationId, 
        itemCount: items.length 
      });

    } catch (error) {
      this.#logger.error('processGratitudeInput.failed', {
        conversationId,
        error: error.message,
        stack: error.stack,
      });

      if (this.#messagingGateway) {
        try {
          await this.#messagingGateway.sendMessage(conversationId, 
            '❌ Sorry, something went wrong. Please try again.'
          );
        } catch (e) {
          // Ignore send error
        }
      }
    }
  }

  /**
   * Transcribe voice to text
   * @private
   */
  async #transcribeVoice(fileId) {
    if (!this.#aiGateway) {
      throw new Error('AI gateway not configured for voice transcription');
    }
    
    // Get file URL from Telegram
    const fileUrl = await this.#messagingGateway.getFileUrl(fileId);
    
    // Transcribe using Whisper
    return this.#aiGateway.transcribeAudio(fileUrl);
  }

  /**
   * Extract items from text using AI
   * @private
   * @returns {Promise<{items: string[], category: string}>}
   */
  async #extractItems(text) {
    if (!this.#aiGateway) {
      // Fallback: simple comma/and split
      this.#logger.warn('processGratitudeInput.noAI', { fallback: 'simple_split' });
      return { items: this.#simpleExtract(text), category: 'gratitude' };
    }

    try {
      const prompt = EXTRACTION_PROMPT.replace('{text}', text);
      
      const response = await this.#aiGateway.chatWithJson([
        { role: 'system', content: 'You extract gratitude/hope items and classify them. Return JSON only.' },
        { role: 'user', content: prompt },
      ], { 
        model: 'gpt-4o-mini',
      });

      // Handle response - expect { items: [...], category: "gratitude"|"hopes" }
      const items = Array.isArray(response) ? response : (response?.items || []);
      const category = response?.category === 'hopes' ? 'hopes' : 'gratitude';
      
      this.#logger.debug('processGratitudeInput.extract.result', { 
        itemCount: items.length, 
        category 
      });
      
      return { items, category };
      
    } catch (error) {
      this.#logger.error('processGratitudeInput.extract.failed', { error: error.message });
      return { items: this.#simpleExtract(text), category: 'gratitude' };
    }
  }

  /**
   * Simple fallback extraction without AI
   * @private
   */
  #simpleExtract(text) {
    // Split by comma, "and", or newline
    const items = text
      .split(/[,\n]|\band\b/i)
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.length < 100)
      .map(s => this.#toTitleCase(s));
    
    return items.slice(0, 10); // Limit to 10 items
  }

  /**
   * Convert string to Title Case
   * @private
   */
  #toTitleCase(str) {
    return str
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Get household members
   * @private
   */
  async #getHouseholdMembers() {
    if (this.#householdRepository) {
      return this.#householdRepository.getHouseholdMembers();
    }
    
    // Fallback: return empty array
    this.#logger.warn('processGratitudeInput.noHouseholdRepository');
    return [];
  }

  /**
   * Update status message
   * @private
   */
  async #updateStatus(conversationId, messageId, text, parseMode = null) {
    if (!messageId) {
      await this.#messagingGateway.sendMessage(conversationId, text, { 
        parseMode 
      });
      return;
    }
    
    try {
      await this.#messagingGateway.updateMessage(conversationId, messageId, {
        text,
        parseMode,
      });
    } catch (e) {
      // If edit fails, send new message
      await this.#messagingGateway.sendMessage(conversationId, text, { 
        parseMode 
      });
    }
  }

  /**
   * Build the confirmation message text
   * @private
   */
  #buildConfirmationMessage(items, category) {
    const header = `📝 <b>Items to Add</b>\n\n`;
    const itemList = items.map(item => `• ${item}`).join('\n');
    const categoryLabel = category === 'gratitude' ? 'grateful' : 'hoping';
    const prompt = `\n\n<i>Who is ${categoryLabel} for these?</i>`;
    
    return header + itemList + prompt;
  }

  /**
   * Build the confirmation keyboard with category toggle and user buttons
   * @private
   */
  #buildConfirmationKeyboard(members, currentCategory) {
    const keyboard = [];
    
    // Category toggle row
    keyboard.push([
      {
        text: currentCategory === 'gratitude' ? '✅ Gratitude' : 'Gratitude',
        callback_data: 'category:gratitude',
      },
      {
        text: currentCategory === 'hopes' ? '✅ Hopes' : 'Hopes',
        callback_data: 'category:hopes',
      },
    ]);

    // Member rows (3 per row)
    const memberButtons = members.map(m => ({
      text: m.displayName,
      callback_data: `user:${m.username}`,
    }));
    
    for (let i = 0; i < memberButtons.length; i += 3) {
      keyboard.push(memberButtons.slice(i, i + 3));
    }

    // Cancel row
    keyboard.push([{ text: '❌ Cancel', callback_data: 'cancel' }]);

    return keyboard;
  }
}

export default ProcessGratitudeInput;
