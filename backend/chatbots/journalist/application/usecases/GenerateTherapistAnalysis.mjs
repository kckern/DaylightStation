/**
 * Generate Therapist Analysis Use Case
 * @module journalist/application/usecases/GenerateTherapistAnalysis
 * 
 * Generates a supportive therapist-style analysis of journal entries.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';
import { 
  formatAsChat, 
  truncateToLength 
} from '../../domain/services/HistoryFormatter.mjs';
import { buildTherapistPrompt } from '../../domain/services/PromptBuilder.mjs';

/**
 * Generate therapist analysis use case
 */
export class GenerateTherapistAnalysis {
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
   * @param {Object} input
   * @param {string} input.chatId
   */
  async execute(input) {
    const { chatId } = input;

    this.#logger.debug('analysis.therapist.start', { chatId });

    try {
      // 1. Delete pending unanswered messages
      if (this.#messageQueueRepository) {
        await this.#messageQueueRepository.deleteUnprocessed(chatId);
      }

      // 2. Load extended conversation history
      let history = '';
      if (this.#journalEntryRepository?.getMessageHistory) {
        const messages = await this.#journalEntryRepository.getMessageHistory(chatId, 50);
        history = formatAsChat(messages);
      }

      if (!history || history.trim().length < 100) {
        await this.#messagingGateway.sendMessage(
          chatId,
          '📘 I don\'t have enough journal entries to provide an analysis yet. Keep journaling and try again later!',
          {}
        );
        return { success: false, error: 'Insufficient history' };
      }

      // 3. Build therapist analysis prompt
      const prompt = this.#buildAnalysisPrompt(truncateToLength(history, 6000));

      // 4. Call AI for analysis
      const analysis = await this.#aiGateway.chat(prompt, { 
        maxTokens: 800,
        temperature: 0.7,
      });

      // 5. Send analysis with prefix
      const { messageId } = await this.#messagingGateway.sendMessage(
        chatId,
        `📘 ${analysis}`,
        { parseMode: 'HTML' }
      );

      this.#logger.info('analysis.therapist.complete', { chatId, messageId });

      return {
        success: true,
        messageId,
        analysis,
      };
    } catch (error) {
      this.#logger.error('analysis.therapist.error', { chatId, error: error.message });
      throw error;
    }
  }

  /**
   * Build analysis prompt
   * @private
   */
  #buildAnalysisPrompt(history) {
    return buildTherapistPrompt(history);
  }
}

export default GenerateTherapistAnalysis;
