/**
 * Initiate Debrief Interview Use Case
 * @module journalist/application/usecases/InitiateDebriefInterview
 * 
 * Starts an interview session based on the morning debrief content.
 */

import { createLogger } from '../../../../_lib/logging/index.mjs';
import { 
  formatAsChat, 
  truncateToLength 
} from '../../domain/services/HistoryFormatter.mjs';
import { parseGPTResponse } from '../../domain/services/QuestionParser.mjs';
import { 
  formatQuestion,
  formatChoicesAsKeyboard
} from '../../domain/services/QueueManager.mjs';

/**
 * Initiate debrief interview use case
 */
export class InitiateDebriefInterview {
  #messagingGateway;
  #aiGateway;
  #journalEntryRepository;
  #messageQueueRepository;
  #debriefRepository;
  #conversationStateStore;
  #userResolver;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    if (!deps.aiGateway) throw new Error('aiGateway is required');

    this.#messagingGateway = deps.messagingGateway;
    this.#aiGateway = deps.aiGateway;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#messageQueueRepository = deps.messageQueueRepository;
    this.#debriefRepository = deps.debriefRepository;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#userResolver = deps.userResolver;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.conversationId - Conversation ID
   * @param {string} [input.debriefDate] - Optional specific debrief date
   * @param {string} [input.instructions] - Optional instructions (e.g., 'change_subject')
   * @param {string} [input.previousQuestion] - Previous question to avoid repeating
   */
  async execute(input) {
    const { conversationId, debriefDate, instructions, previousQuestion } = input;

    this.#logger.debug('debriefInterview.initiate.start', { conversationId, debriefDate, instructions, previousQuestion });

    try {
      // 1. Get the debrief data
      const username = this.#userResolver.resolveUsername(conversationId);
      let debrief;
      
      if (debriefDate) {
        debrief = await this.#debriefRepository.getDebriefByDate(debriefDate);
      } else {
        const recentDebriefs = await this.#debriefRepository.getRecentDebriefs(username, 1);
        debrief = recentDebriefs?.[0];
      }

      if (!debrief) {
        await this.#messagingGateway.sendMessage(
          conversationId,
          "No debrief found to interview about."
        );
        return { success: false };
      }

      // 2. Clear any existing queue
      if (this.#messageQueueRepository) {
        await this.#messageQueueRepository.clearQueue(conversationId);
      }

      // 3. Load journal history
      let history = '';
      if (this.#journalEntryRepository?.getMessageHistory) {
        const messages = await this.#journalEntryRepository.getMessageHistory(conversationId, 20);
        history = formatAsChat(messages);
      }

      // 4. Build context from debrief
      const debriefContext = this.#buildDebriefContext(debrief);

      // 5. Get previous questions from state to avoid repetition
      let askedQuestions = [];
      if (this.#conversationStateStore) {
        const state = await this.#conversationStateStore.get(conversationId);
        // Custom data is stored in flowState
        askedQuestions = state?.flowState?.askedQuestions || [];
        if (previousQuestion && !askedQuestions.includes(previousQuestion)) {
          askedQuestions.push(previousQuestion);
        }
      }

      // 6. Generate opening question based on debrief
      const isChangeSubject = instructions === 'change_subject';
      const prompt = this.#buildInterviewPrompt(debriefContext, history, isChangeSubject, askedQuestions);
      const messages = [{ role: 'user', content: prompt }];
      const response = await this.#aiGateway.chat(messages, { maxTokens: 150 });
      
      const questions = parseGPTResponse(response);
      const question = questions[0] || 'Tell me more about your day.';

      // 6. Generate multiple choices
      const choices = await this.#generateChoices(debriefContext, history, question);

      // 8. Send question with reply keyboard
      const formattedQuestion = formatQuestion(question, '💬');
      const { messageId } = await this.#messagingGateway.sendMessage(
        conversationId,
        formattedQuestion,
        { choices }
      );

      // Save to journal history
      if (this.#journalEntryRepository) {
        await this.#journalEntryRepository.saveMessage({
          id: messageId,
          chatId: conversationId,
          role: 'assistant',
          content: formattedQuestion,
          senderId: 'bot',
          senderName: 'Journalist'
        });
      }

      // 9. Update state with asked question for future "Change Subject" requests
      if (this.#conversationStateStore) {
        const currentState = await this.#conversationStateStore.get(conversationId);
        const currentFlowState = currentState?.flowState || {};
        const updatedQuestions = [...(currentFlowState.askedQuestions || []), question];
        
        await this.#conversationStateStore.set(conversationId, {
          activeFlow: 'morning_debrief',
          flowState: {
            ...currentFlowState,
            lastQuestion: question,
            askedQuestions: updatedQuestions.slice(-5), // Keep last 5 questions
            lastMessageId: messageId,
            debrief: currentState?.flowState?.debrief || currentFlowState.debrief,
          },
        });
      }

      this.#logger.info('debriefInterview.initiate.complete', { conversationId, messageId });

      return {
        success: true,
        messageId,
        question,
      };
    } catch (error) {
      this.#logger.error('debriefInterview.initiate.error', { 
        conversationId, 
        error: error.message 
      });
      throw error;
    }
  }

  /**
   * Build debrief context string
   * @private
   */
  #buildDebriefContext(debrief) {
    let context = `DATE: ${debrief.date}\n\n`;
    context += `SUMMARY: ${debrief.summary}\n\n`;
    
    if (debrief.summaries && debrief.summaries.length > 0) {
      context += `DETAILED DATA:\n`;
      for (const summary of debrief.summaries) {
        context += `\n${summary.text}\n`;
      }
    }
    
    return context;
  }

  /**
   * Build interview prompt
   * @private
   * @param {string} debriefContext - The debrief context
   * @param {string} history - Conversation history
   * @param {boolean} isChangeSubject - Whether this is a change_subject request
   * @param {string[]} askedQuestions - Previously asked questions to avoid
   */
  #buildInterviewPrompt(debriefContext, history, isChangeSubject = false, askedQuestions = []) {
    let changeSubjectInstructions = '';
    
    if (isChangeSubject || askedQuestions.length > 0) {
      changeSubjectInstructions = `
IMPORTANT: The user wants a question about a DIFFERENT topic from the debrief.
`;
      if (askedQuestions.length > 0) {
        changeSubjectInstructions += `
PREVIOUSLY ASKED QUESTIONS (DO NOT repeat these topics):
${askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Pick a COMPLETELY DIFFERENT aspect of the debrief data - different activity, different metric, different event.
`;
      }
    }

    const historyContext = history ? `\nRECENT CONVERSATION:\n${truncateToLength(history, 2000)}\n` : '';
    
    return `You are an autobiographer helping someone journal about their life.

You have access to their morning debrief with detailed data about their previous day:

${debriefContext}${historyContext}
${changeSubjectInstructions}
Based on the debrief data and recent conversation above, generate ONE thoughtful follow-up question that:
- References specific details from the debrief (activities, metrics, events, commits, etc.)
- Encourages reflection or elaboration on something interesting
- Is conversational and personal
- Avoids yes/no questions

Return ONLY the question text, no preamble.`;
  }

  /**
   * Generate multiple choice options
   * @private
   */
  async #generateChoices(debriefContext, history, question) {
    const systemPrompt = `Generate 4 short, PLAUSIBLE answers to a follow-up question about the user's daily debrief.

CRITICAL RULES:
- Each option MUST directly answer the specific question asked
- Options should be things the user might actually say
- Be specific to the activities, metrics, or events mentioned in the debrief
- Keep options 2-6 words each
- Include variety: specific answers, vague answers, "neither/other" type options

Respond with ONLY a JSON array of 4 strings.`;

    const userPrompt = `Here's the user's daily debrief:

${truncateToLength(debriefContext, 1500)}

Follow-up question: "${question}"

Generate 4 plausible answers:`;

    try {
      const response = await this.#aiGateway.chat(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ], 
        { maxTokens: 100 }
      );
      
      this.#logger.debug('debriefInterview.choices.aiResponse', { response });
      
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
      
      this.#logger.debug('debriefInterview.choices.parsed', { choices, count: choices.length });
      
      if (Array.isArray(choices) && choices.length >= 4) {
        return formatChoicesAsKeyboard(choices.slice(0, 4));
      }
    } catch (err) {
      this.#logger.warn('debriefInterview.choices.failed', { error: err.message, stack: err.stack });
    }

    // Fallback with generic options + control buttons
    return formatChoicesAsKeyboard(['Yes', 'No', 'Maybe', 'Not sure']);
  }
}
