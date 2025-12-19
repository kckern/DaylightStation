/**
 * Initiate Journal Prompt Use Case
 * @module journalist/application/usecases/InitiateJournalPrompt
 * 
 * Initiates a journaling session with an opening question.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { 
  formatAsChat, 
  truncateToLength 
} from '../../domain/services/HistoryFormatter.mjs';
import { parseGPTResponse } from '../../domain/services/QuestionParser.mjs';
import { 
  formatQuestion, 
  buildDefaultChoices 
} from '../../domain/services/QueueManager.mjs';
import { 
  buildAutobiographerPrompt,
  buildMultipleChoicePrompt,
} from '../../domain/services/PromptBuilder.mjs';

/**
 * @typedef {Object} InitiateJournalPromptInput
 * @property {string} chatId
 * @property {string} [instructions] - Optional instructions (e.g., 'change_subject')
 */

/**
 * Initiate journal prompt use case
 */
export class InitiateJournalPrompt {
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {InitiateJournalPromptInput} input
   */
  async execute(input) {
    const { chatId, instructions } = input;

    this.#logger.debug('journalPrompt.initiate.start', { chatId, instructions });

    try {
      // 1. Clear any existing queue
      if (this.#messageQueueRepository) {
        await this.#messageQueueRepository.clearQueue(chatId);
      }

      // 2. Load history (skip if change_subject)
      let history = '';
      if (instructions !== 'change_subject' && this.#journalEntryRepository?.getMessageHistory) {
        const messages = await this.#journalEntryRepository.getMessageHistory(chatId, 10);
        history = formatAsChat(messages);
      }

      // 3. Generate opening question
      const prompt = buildAutobiographerPrompt(truncateToLength(history, 2000));
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 150 });
      
      const questions = parseGPTResponse(response);
      const question = questions[0] || 'What\'s on your mind today?';

      // 4. Generate multiple choices
      const choices = await this.#generateChoices(history, question);

      // 5. Send question
      const formattedQuestion = formatQuestion(question, '📘');
      const { messageId } = await this.#messagingGateway.sendMessage(
        chatId,
        formattedQuestion,
        { choices, inline: true }
      );

      this.#logger.info('journalPrompt.initiate.complete', { chatId, messageId });

      return {
        success: true,
        messageId,
        prompt: question,
      };
    } catch (error) {
      this.#logger.error('journalPrompt.initiate.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Generate multiple choice options
   * @private
   */
  async #generateChoices(history, question) {
    const prompt = buildMultipleChoicePrompt(
      truncateToLength(history, 1000),
      '',
      question
    );

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 200 });
      const choices = parseGPTResponse(response);

      if (choices.length >= 2) {
        const keyboard = choices.slice(0, 5).map(c => [c]);
        keyboard.push(...buildDefaultChoices());
        return keyboard;
      }
    } catch (error) {
      this.#logger.warn('journalPrompt.choiceGeneration.failed', { error: error.message });
    }

    return buildDefaultChoices();
  }
}

export default InitiateJournalPrompt;
