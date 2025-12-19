/**
 * Process Text Entry Use Case (dearDiary)
 * @module journalist/application/usecases/ProcessTextEntry
 * 
 * Main use case for processing text journal entries.
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
} from '../../domain/services/QueueManager.mjs';
import { 
  buildBiographerPrompt, 
  buildEvaluateResponsePrompt,
  buildMultipleChoicePrompt,
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

      // 3. Check for existing queue
      const queue = this.#messageQueueRepository 
        ? await this.#messageQueueRepository.loadUnsentQueue(chatId)
        : [];

      // 4. If queue exists, evaluate if we should continue
      if (queue.length > 0) {
        const shouldContinue = await this.#evaluateResponsePath(historyText, text, queue);
        
        if (shouldContinue) {
          // Continue with queued questions
          return this.#sendNextQueued(chatId, queue);
        } else {
          // Clear queue and generate new follow-up
          if (this.#messageQueueRepository) {
            await this.#messageQueueRepository.clearQueue(chatId);
          }
        }
      }

      // 5. Generate follow-up questions
      const questions = await this.#generateFollowUp(historyText, text);

      if (questions.length === 0) {
        // No questions generated - send acknowledgment
        const { messageId: sentId } = await this.#messagingGateway.sendMessage(
          chatId,
          '📝 Thanks for sharing.',
          {}
        );
        return { success: true, messageId: sentId };
      }

      // 6. If multiple questions, queue them
      if (questions.length > 1 && this.#messageQueueRepository) {
        const queueItems = createQueueFromQuestions(chatId, questions.slice(1));
        await this.#messageQueueRepository.saveToQueue(chatId, queueItems);
      }

      // 7. Generate choices for first question
      const firstQuestion = questions[0];
      const choices = await this.#generateMultipleChoices(historyText, text, firstQuestion);

      // 8. Send question
      const formattedQuestion = formatQuestion(firstQuestion, '📖');
      const { messageId: sentId } = await this.#messagingGateway.sendMessage(
        chatId,
        formattedQuestion,
        { choices, inline: true }
      );

      this.#logger.info('textEntry.process.complete', { chatId, questionCount: questions.length });

      return {
        success: true,
        messageId: sentId,
        prompt: firstQuestion,
        queuedCount: questions.length - 1,
      };
    } catch (error) {
      this.#logger.error('textEntry.process.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Load conversation history
   * @private
   */
  async #loadHistory(chatId) {
    if (!this.#journalEntryRepository?.getMessageHistory) {
      return [];
    }
    return this.#journalEntryRepository.getMessageHistory(chatId, 20);
  }

  /**
   * Evaluate if response allows continuing queue
   * @private
   */
  async #evaluateResponsePath(history, response, queue) {
    const plannedQuestions = queue.map(q => q.queuedMessage);
    const prompt = buildEvaluateResponsePrompt(
      truncateToLength(history, 2000),
      response,
      plannedQuestions
    );

    const result = await this.#aiGateway.chat(prompt, { maxTokens: 10 });
    return shouldContinueQueue(result);
  }

  /**
   * Generate follow-up questions
   * @private
   */
  async #generateFollowUp(history, entry) {
    const prompt = buildBiographerPrompt(
      truncateToLength(history, 3000),
      entry
    );

    const response = await this.#aiGateway.chat(prompt, { maxTokens: 300 });
    const questions = parseGPTResponse(response);

    // Split compound questions
    const allQuestions = [];
    for (const q of questions) {
      allQuestions.push(...splitMultipleQuestions(q));
    }

    return allQuestions.slice(0, 3); // Max 3 questions
  }

  /**
   * Generate multiple choice options
   * @private
   */
  async #generateMultipleChoices(history, comment, question) {
    const prompt = buildMultipleChoicePrompt(
      truncateToLength(history, 1500),
      comment,
      question
    );

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 200 });
      const choices = parseGPTResponse(response);

      if (choices.length >= 2) {
        // Format as keyboard rows (one choice per row)
        const keyboard = choices.slice(0, 5).map(c => [c]);
        // Add default buttons
        keyboard.push(...buildDefaultChoices());
        return keyboard;
      }
    } catch (error) {
      this.#logger.warn('textEntry.choiceGeneration.failed', { error: error.message });
    }

    // Fall back to default choices
    return buildDefaultChoices();
  }

  /**
   * Send next queued question
   * @private
   */
  async #sendNextQueued(chatId, queue) {
    const nextItem = getNextUnsent(queue);
    if (!nextItem) {
      return { success: true, queueEmpty: true };
    }

    // Generate choices
    const history = await this.#loadHistory(chatId);
    const historyText = formatAsChat(history);
    const choices = await this.#generateMultipleChoices(historyText, '', nextItem.queuedMessage);

    // Send
    const formattedQuestion = formatQuestion(nextItem.queuedMessage, '⏩');
    const { messageId } = await this.#messagingGateway.sendMessage(
      chatId,
      formattedQuestion,
      { choices, inline: true }
    );

    // Mark as sent
    if (this.#messageQueueRepository) {
      await this.#messageQueueRepository.markSent(nextItem.uuid, messageId);
    }

    return {
      success: true,
      messageId,
      fromQueue: true,
    };
  }
}

export default ProcessTextEntry;
