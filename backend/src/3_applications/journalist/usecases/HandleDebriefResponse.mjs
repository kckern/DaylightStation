/**
 * Handle Debrief Response Use Case
 * @module journalist/usecases/HandleDebriefResponse
 *
 * Handles the 3 main debrief response buttons:
 * - 📊 Show Details → Show source picker keyboard
 * - 💬 Ask Me → Start interview flow with follow-up questions
 * - ✅ Accept → Remove keyboard, mark debrief complete
 */

import { SendMorningDebrief } from './SendMorningDebrief.mjs';
import { nowTs24 } from '#system/utils/index.mjs';

/**
 * Handle debrief response buttons
 */
export class HandleDebriefResponse {
  #messagingGateway;
  #conversationStateStore;
  #debriefRepository;
  #journalEntryRepository;
  #userResolver;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
   * @param {Object} deps.conversationStateStore - State persistence
   * @param {Object} deps.debriefRepository - Debrief persistence
   * @param {Object} deps.userResolver - User resolution
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#debriefRepository = deps.debriefRepository;
    this.#journalEntryRepository = deps.journalEntryRepository;
    this.#userResolver = deps.userResolver;
    this.#logger = deps.logger || console;
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
      updateKeyboard: (msgId, choices) => this.#messagingGateway.updateKeyboard(conversationId, msgId, choices),
    };
  }

  /**
   * Execute handling a debrief response
   *
   * @param {Object} input
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.text - Button text that was pressed
   * @param {string} [input.messageId] - Message ID to edit (for callback buttons)
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Object} Result
   */
  async execute(input) {
    const { conversationId, text, messageId, responseContext } = input;

    // Store responseContext for use in private methods
    this._responseContext = responseContext;

    this.#logger.info?.('debrief.response.received', {
      conversationId,
      text,
    });

    // Get current debrief state
    const state = await this.#conversationStateStore.get(conversationId);
    if (!state || state.activeFlow !== 'morning_debrief') {
      this.#logger.warn?.('debrief.response.no-active-debrief', { conversationId });
      return { handled: false };
    }

    const messaging = this.#getMessaging(responseContext, conversationId);

    // Route based on button pressed
    if (text === '📊 Details') {
      return this.#handleShowDetails(conversationId, state, messageId, messaging);
    }

    if (text === '💬 Ask') {
      return this.#handleAskMe(conversationId, state, messaging);
    }

    if (text === '✅ OK') {
      return this.#handleAccept(conversationId, state, messaging);
    }

    // Not a debrief button
    return { handled: false };
  }

  /**
   * Handle "Show Details" - show source picker keyboard
   * @param {string} conversationId
   * @param {Object} state
   * @param {string} [messageId] - Message ID to edit keyboard
   * @param {Object} messaging - Messaging interface
   */
  async #handleShowDetails(conversationId, state, messageId, messaging) {
    // Username is optional - used only for logging in DebriefRepository
    // The repository path is already configured at construction time
    const username = null;

    // Get the most recent debrief from debriefs.yml (persistent storage)
    const recentDebriefs = await this.#debriefRepository.getRecentDebriefs(username, 1);

    if (!recentDebriefs || recentDebriefs.length === 0) {
      await messaging.sendMessage('No debrief data found.');
      return { handled: true, action: 'show_details', empty: true };
    }

    const debrief = recentDebriefs[0];
    const summaries = debrief.summaries || [];

    // Extract source names from summary objects (handle both formats: array of strings or array of {source, category, text})
    const sources = summaries
      .map((s) => (typeof s === 'string' ? s : s.source))
      .filter(Boolean);

    if (sources.length === 0) {
      await messaging.sendMessage(
        'No detailed data sources available for this debrief.',
      );
      return { handled: true, action: 'show_details', empty: true };
    }

    // Build source picker keyboard (inline)
    const keyboardMarkup = SendMorningDebrief.buildSourcePickerKeyboard(sources);

    // Update existing message keyboard if messageId provided, otherwise send new message
    let detailsMessageId = messageId;

    if (messageId) {
      // updateKeyboard expects the choices array for inline keyboard
      await messaging.updateKeyboard(
        messageId,
        keyboardMarkup.inline_keyboard,
      );
    } else {
      const result = await messaging.sendMessage(
        'Select a data source to view details:',
        { reply_markup: keyboardMarkup },
      );

      detailsMessageId = result?.messageId;

      if (this.#journalEntryRepository && detailsMessageId) {
        await this.#journalEntryRepository.saveMessage({
          id: detailsMessageId,
          chatId: conversationId,
          role: 'assistant',
          content: 'Select a data source to view details:',
          senderId: 'bot',
          senderName: 'Journalist',
        });
      }
    }

    // Update state to source picker mode, store debrief date
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      subFlow: 'source_picker',
      debriefDate: debrief.date,
      detailsMessageId,
    });

    this.#logger.info?.('debrief.show-details', {
      conversationId,
      sources: sources.length,
    });

    return { handled: true, action: 'show_details', sources };
  }

  /**
   * Handle "Ask Me" - start interview flow with questions
   * @param {Object} messaging - Messaging interface
   */
  async #handleAskMe(conversationId, state, messaging) {
    const questions = state.debrief?.questions || {};
    const categories = state.debrief?.categories || [];

    // Find a category with questions
    let selectedCategory = null;
    let selectedQuestions = [];

    for (const cat of categories) {
      if (questions[cat.key] && questions[cat.key].length > 0) {
        selectedCategory = cat;
        selectedQuestions = questions[cat.key];
        break;
      }
    }

    if (!selectedCategory || selectedQuestions.length === 0) {
      // Fallback to generic question
      await messaging.sendMessage(
        'What stood out most about yesterday?',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎲 Different question', callback_data: 'journal:change' }],
              [{ text: '✅ Done', callback_data: 'journal:done' }],
            ],
          },
        },
      );

      return { handled: true, action: 'ask_me', fallback: true };
    }

    // Ask the first question
    const question = selectedQuestions[0];

    const result = await messaging.sendMessage(
      `${selectedCategory.icon} ${question}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Different question', callback_data: 'journal:change' }],
            [{ text: '⏭️ Skip', callback_data: 'journal:skip' }],
            [{ text: '✅ Done', callback_data: 'journal:done' }],
          ],
        },
      },
    );

    if (this.#journalEntryRepository && result?.messageId) {
      await this.#journalEntryRepository.saveMessage({
        id: result.messageId,
        chatId: conversationId,
        role: 'assistant',
        content: `${selectedCategory.icon} ${question}`,
        senderId: 'bot',
        senderName: 'Journalist',
      });
    }

    // Update state to interview mode
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      subFlow: 'interview',
      currentCategory: selectedCategory.key,
      currentQuestionIndex: 0,
      askedCategories: [selectedCategory.key],
    });

    this.#logger.info?.('debrief.ask-me.started', {
      conversationId,
      category: selectedCategory.key,
      question,
    });

    return { handled: true, action: 'ask_me', category: selectedCategory.key };
  }

  /**
   * Handle "Accept" - remove keyboard, mark complete
   * @param {Object} messaging - Messaging interface
   */
  async #handleAccept(conversationId, state, messaging) {
    // Send confirmation with keyboard removed
    await messaging.sendMessage(
      '✓ Got it. Feel free to write anything on your mind, or just go about your day.',
      {
        reply_markup: { remove_keyboard: true },
      },
    );

    // Delete the debrief message from history if repository exists
    if (this.#journalEntryRepository?.delete) {
      if (state.messageId) {
        await this.#journalEntryRepository.delete(state.messageId, conversationId);
      }
      if (state.detailsMessageId) {
        await this.#journalEntryRepository.delete(state.detailsMessageId, conversationId);
      }
    }

    // Update state - debrief accepted but conversation still open
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      activeFlow: 'free_write',
      debriefAccepted: true,
      acceptedAt: nowTs24(),
    });

    this.#logger.info?.('debrief.accepted', {
      conversationId,
      date: state.debrief?.date,
    });

    return { handled: true, action: 'accept' };
  }
}

export default HandleDebriefResponse;
