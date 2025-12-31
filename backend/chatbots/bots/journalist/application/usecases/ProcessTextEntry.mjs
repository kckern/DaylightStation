/**
 * Process Text Entry Use Case (dearDiary)
 * @module journalist/application/usecases/ProcessTextEntry
 * 
 * Main use case for processing text journal entries.
 * Implements conversational journaling loop with active listening.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { ConversationMessage } from '../../domain/entities/ConversationMessage.mjs';
import { 
  formatAsChat, 
  truncateToLength, 
  buildChatContext 
} from '../../domain/services/HistoryFormatter.mjs';
import { 
  parseGPTResponse, 
  splitMultipleQuestions 
} from '../../domain/services/QuestionParser.mjs';
import { 
  shouldContinueQueue, 
  createQueueFromQuestions,
  getNextUnsent,
  formatQuestion,
  buildDefaultChoices,
  formatChoicesAsKeyboard,
} from '../../domain/services/QueueManager.mjs';
import { 
  buildBiographerPrompt, 
  buildEvaluateResponsePrompt,
  buildMultipleChoicePrompt,
  buildConversationalPrompt,
  buildConversationalChoicesPrompt,
} from '../../domain/services/PromptBuilder.mjs';

/**
 * @typedef {Object} ProcessTextEntryInput
 * @property {string} chatId
 * @property {string} text
 * @property {string} messageId
 * @property {string} senderId
 * @property {string} senderName
 */

/**
 * Process text entry use case
 */
export class ProcessTextEntry {
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #conversationStateStore;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {ProcessTextEntryInput} input
   */
  async execute(input) {
    const { chatId, text, messageId, senderId, senderName } = input;

    this.#logger.debug('textEntry.process.start', { chatId, textLength: text.length });

    try {
      // 1. Save message to history
      const userMessage = ConversationMessage.createUserMessage({
        messageId,
        chatId,
        senderId,
        senderName,
        text,
      });

      if (this.#journalEntryRepository) {
        await this.#journalEntryRepository.saveMessage?.(userMessage);
      }

      // 2. Load conversation history
      const history = await this.#loadHistory(chatId);
      const historyText = formatAsChat(history);

      // 3. Generate conversational response (acknowledgment + follow-up)
      const response = await this.#generateConversationalResponse(historyText, text);

      if (!response) {
        // Fallback: just acknowledge
        const { messageId: sentId } = await this.#messagingGateway.sendMessage(
          chatId,
          '📝 Noted.',
          {}
        );
        
        // Save bot response
        if (this.#journalEntryRepository) {
          const botMessage = ConversationMessage.createBotMessage({
            messageId: sentId,
            chatId,
            text: '📝 Noted.',
          });
          await this.#journalEntryRepository.saveMessage?.(botMessage);
        }
        
        return { success: true, messageId: sentId };
      }

      // 4. Generate multiple choice options for the follow-up question
      const choices = await this.#generateConversationalChoices(response.question, text);

      // 5. Build message - use question as the full response (acknowledgment may be empty)
      const message = response.acknowledgment 
        ? `${response.acknowledgment}\n\n${response.question}`
        : response.question;

      // 6. Send with reply keyboard (attached to chat input)
      const { messageId: sentId } = await this.#messagingGateway.sendMessage(
        chatId,
        message,
        { choices }
      );

      // 7. Save bot response to history
      if (this.#journalEntryRepository) {
        const botMessage = ConversationMessage.createBotMessage({
          messageId: sentId,
          chatId,
          text: message,
        });
        await this.#journalEntryRepository.saveMessage?.(botMessage);
      }

      this.#logger.info('textEntry.process.complete', { chatId });

      return {
        success: true,
        messageId: sentId,
        acknowledgment: response.acknowledgment,
        question: response.question,
      };
    } catch (error) {
      this.#logger.error('textEntry.process.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Generate conversational response (acknowledgment + follow-up question)
   * @private
   */
  async #generateConversationalResponse(history, entry) {
    const prompt = buildConversationalPrompt(
      truncateToLength(history, 2000),
      entry
    );

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 150 });
      
      // Parse JSON response - extract from markdown code blocks if needed
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.#logger.warn('textEntry.conversational.noJsonFound', { response });
        return null;
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // Accept response if question exists (acknowledgment may be empty)
      if (parsed.question) {
        return {
          acknowledgment: parsed.acknowledgment || '',
          question: parsed.question
        };
      }
    } catch (error) {
      this.#logger.warn('textEntry.conversational.parseFailed', { 
        error: error.message 
      });
    }

    return null;
  }

  /**
   * Generate multiple choice options for conversational follow-up
   * @private
   */
  async #generateConversationalChoices(question, context) {
    const prompt = buildConversationalChoicesPrompt(question, context);

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 100 });
      
      // Try to parse as JSON array
      let choices = [];
      try {
        choices = JSON.parse(response);
      } catch {
        // Try to extract from markdown code block
        const match = response.match(/\[[\s\S]*\]/);
        if (match) {
          choices = JSON.parse(match[0]);
        }
      }

      if (Array.isArray(choices) && choices.length >= 2) {
        return formatChoicesAsKeyboard(choices.slice(0, 4));
      }
    } catch (error) {
      this.#logger.warn('textEntry.choices.parseFailed', { error: error.message });
    }

    // Fallback: generic options + close
    return formatChoicesAsKeyboard(['Yes', 'No', 'Tell me more']);
  }

  /**
   * Load conversation history
   * @private
   */
  async #loadHistory(chatId) {
    if (!this.#journalEntryRepository?.getMessageHistory) {
      return [];
    }
    // Load up to 100 messages (roughly covers 7 days of active conversation)
    return this.#journalEntryRepository.getMessageHistory(chatId, 100);
  }
}

export default ProcessTextEntry;
