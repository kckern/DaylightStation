/**
 * Initiate Journal Prompt Use Case
 * @module journalist/application/usecases/InitiateJournalPrompt
 *
 * Initiates a journaling session with an opening question.
 */

import moment from 'moment-timezone';
import {
  formatAsChat,
  truncateToLength,
} from '../../../1_domains/journalist/services/HistoryFormatter.mjs';
import { parseGPTResponse } from '../../../1_domains/journalist/services/QuestionParser.mjs';
import {
  formatQuestion,
  buildDefaultChoices,
} from '../../../1_domains/journalist/services/QueueManager.mjs';
import { buildAutobiographerPrompt, buildMultipleChoicePrompt } from '../../../1_domains/journalist/services/PromptBuilder.mjs';

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
  #lifelogAggregator;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#lifelogAggregator = deps.lifelogAggregator;
    this.#logger = deps.logger || console;
  }

  /**
   * Get messaging interface (prefers responseContext for DDD compliance)
   * @private
   */
  #getMessaging(responseContext, chatId) {
    if (responseContext) {
      return responseContext;
    }
    return {
      sendMessage: (text, options) => this.#messagingGateway.sendMessage(chatId, text, options),
    };
  }

  /**
   * Execute the use case
   * @param {InitiateJournalPromptInput} input
   */
  async execute(input) {
    const { chatId, instructions, responseContext } = input;

    this.#logger.debug?.('journalPrompt.initiate.start', { chatId, instructions, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, chatId);

    try {
      // 1. Clear any existing queue
      if (this.#messageQueueRepository) {
        await this.#messageQueueRepository.clearQueue(chatId);
      }

      // 2. Load history (always include for context)
      let history = '';
      if (this.#journalEntryRepository?.getMessageHistory) {
        const messages = await this.#journalEntryRepository.getMessageHistory(chatId, 10);
        history = formatAsChat(messages);
      }

      // 3. Load today's lifelog data for context
      let lifelogContext = '';
      if (this.#lifelogAggregator) {
        try {
          const username = this.#journalEntryRepository?.getUsername?.(chatId) || 'unknown';
          const today = moment().format('YYYY-MM-DD');
          const lifelog = await this.#lifelogAggregator.aggregate(username, today);

          if (lifelog.summaryText) {
            lifelogContext = lifelog.summaryText;
          }
        } catch (err) {
          this.#logger.debug?.('journalPrompt.lifelog.skip', { chatId, error: err.message });
        }
      }

      // 4. Generate opening question
      const prompt = buildAutobiographerPrompt(
        truncateToLength(history, 1500),
        truncateToLength(lifelogContext, 1500),
      );
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 150 });

      const questions = parseGPTResponse(response);
      const question = questions[0] || "What's on your mind today?";

      // 4. Generate multiple choices
      const choices = await this.#generateChoices(history, question);

      // 5. Send question with reply keyboard (attached to chat input)
      const formattedQuestion = formatQuestion(question, '📘');
      const { messageId } = await messaging.sendMessage(formattedQuestion, {
        choices,
      });

      this.#logger.info?.('journalPrompt.initiate.complete', { chatId, messageId });

      return {
        success: true,
        messageId,
        prompt: question,
      };
    } catch (error) {
      this.#logger.error?.('journalPrompt.initiate.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Generate multiple choice options
   * @private
   */
  async #generateChoices(history, question) {
    const prompt = buildMultipleChoicePrompt(truncateToLength(history, 1000), '', question);

    try {
      const response = await this.#aiGateway.chat(prompt, { maxTokens: 200 });
      const choices = parseGPTResponse(response);

      if (choices.length >= 2) {
        // Add number emojis to distinguish canned responses
        const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
        const keyboard = choices.slice(0, 5).map((c, i) => [`${numberEmojis[i]} ${c}`]);
        keyboard.push(...buildDefaultChoices());
        return keyboard;
      }
    } catch (error) {
      this.#logger.warn?.('journalPrompt.choiceGeneration.failed', { error: error.message });
    }

    return buildDefaultChoices();
  }
}

export default InitiateJournalPrompt;
