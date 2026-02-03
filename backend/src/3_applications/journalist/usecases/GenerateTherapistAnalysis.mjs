/**
 * Generate Therapist Analysis Use Case
 * @module journalist/application/usecases/GenerateTherapistAnalysis
 *
 * Generates a supportive therapist-style analysis of journal entries.
 */

import {
  formatAsChat,
  truncateToLength,
} from '#domains/journalist/services/HistoryFormatter.mjs';

/**
 * Generate therapist analysis use case
 */
export class GenerateTherapistAnalysis {
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #debriefRepository;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#debriefRepository = deps.debriefRepository;
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
   * @param {Object} input
   * @param {string} input.chatId
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { chatId, responseContext } = input;

    this.#logger.debug?.('analysis.therapist.start', { chatId, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, chatId);
    let status = null;

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
        await messaging.sendMessage(
          "📘 I don't have enough journal entries to provide an analysis yet. Keep journaling and try again later!",
          {},
        );
        return { success: false, error: 'Insufficient history' };
      }

      // Create status indicator for analysis (this can take a while with large context)
      if (messaging.createStatusIndicator) {
        status = await messaging.createStatusIndicator(
          '📘 Analyzing your journal',
          { frames: ['.', '..', '...'], interval: 2500 }
        );
      }

      // 3. Load recent debrief summaries (15 days back)
      let debriefContext = '';
      if (this.#debriefRepository) {
        const recentDebriefs = await this.#debriefRepository.getRecentDebriefs(null, 15);
        if (recentDebriefs && recentDebriefs.length > 0) {
          debriefContext = recentDebriefs.map((d) => `${d.date}: ${d.summary}`).join('\n');
        }
      }

      // 4. Build therapist analysis prompt with debrief context
      const prompt = this.#buildAnalysisPrompt(truncateToLength(history, 6000), debriefContext);

      // 4. Call AI for analysis
      const analysis = await this.#aiGateway.chat(prompt, {
        maxTokens: 800,
        temperature: 0.7,
      });

      // 5. Send analysis with prefix
      let messageId;
      if (status) {
        messageId = await status.finish(`📘 ${analysis}`, { parseMode: 'HTML' });
      } else {
        const result = await messaging.sendMessage(`📘 ${analysis}`, { parseMode: 'HTML' });
        messageId = result.messageId;
      }

      this.#logger.info?.('analysis.therapist.complete', { chatId, messageId });

      return {
        success: true,
        messageId,
        analysis,
      };
    } catch (error) {
      this.#logger.error?.('analysis.therapist.error', { chatId, error: error.message });

      // Show error in status indicator if available
      if (status) {
        try {
          await status.finish('⚠️ Sorry, I couldn\'t complete the analysis. Please try again later.');
        } catch (e) {
          // Ignore
        }
      }

      throw error;
    }
  }

  /**
   * Build analysis prompt with debrief context
   * @private
   */
  #buildAnalysisPrompt(history, debriefContext = '') {
    const systemPrompt = `You are a supportive therapist providing insight based on journal entries and daily activity summaries. Your analysis should:

1. Identify emotional themes and patterns
2. Note positive developments and strengths
3. Connect journal reflections with daily activities and nutrition
4. Gently highlight areas for potential growth
5. Offer supportive observations (not advice)

Be compassionate and constructive. Write 2-3 paragraphs.`;

    let userContent = `Analyze these journal entries:\n\n${history}`;

    if (debriefContext) {
      userContent += `\n\n--- Recent Daily Activities (Past 15 Days) ---\n${debriefContext}`;
    }

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
  }
}

export default GenerateTherapistAnalysis;
