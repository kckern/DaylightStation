/**
 * Handle Debrief Response Use Case
 * @module journalist/usecases/HandleDebriefResponse
 * 
 * Handles the 3 main debrief response buttons:
 * - 📊 Show Details → Show source picker keyboard
 * - 💬 Ask Me → Start interview flow with follow-up questions  
 * - ✅ Accept → Remove keyboard, mark debrief complete
 */

import { SendMorningDebrief, SOURCE_ICONS } from './SendMorningDebrief.mjs';

/**
 * Handle debrief response buttons
 */
export class HandleDebriefResponse {
  #messagingGateway;
  #conversationStateStore;
  #debriefRepository;
  #userResolver;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.messagingGateway - Telegram gateway
   * @param {Object} deps.conversationStateStore - State persistence
   * @param {Object} deps.debriefRepository - Debrief persistence
   * @param {Object} deps.userResolver - User resolution
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#debriefRepository = deps.debriefRepository;
    this.#userResolver = deps.userResolver;
    this.#logger = deps.logger;
  }

  /**
   * Execute handling a debrief response
   * 
   * @param {Object} input
   * @param {string} input.conversationId - Telegram conversation ID
   * @param {string} input.text - Button text that was pressed
   * @param {string} [input.messageId] - Message ID to edit (for callback buttons)
   * @returns {Object} Result
   */
  async execute(input) {
    const { conversationId, text, messageId } = input;

    this.#logger.info('debrief.response.received', {
      conversationId,
      text
    });

    // Get current debrief state
    const state = await this.#conversationStateStore.get(conversationId);
    if (!state || state.activeFlow !== 'morning_debrief') {
      this.#logger.warn('debrief.response.no-active-debrief', { conversationId });
      return { handled: false };
    }

    // Route based on button pressed
    if (text === '📊 Details') {
      return this.#handleShowDetails(conversationId, state, messageId);
    }
    
    if (text === '💬 Ask') {
      return this.#handleAskMe(conversationId, state);
    }
    
    if (text === '✅ OK') {
      return this.#handleAccept(conversationId, state);
    }

    // Not a debrief button
    return { handled: false };
  }

  /**
   * Handle "Show Details" - show source picker keyboard
   * @param {string} conversationId
   * @param {Object} state
   * @param {string} [messageId] - Message ID to edit keyboard
   */
  async #handleShowDetails(conversationId, state, messageId) {
    // Get username from conversationId
    const username = this.#userResolver.resolveUsername(conversationId);
    
    // Get the most recent debrief from debriefs.yml (persistent storage)
    const recentDebriefs = await this.#debriefRepository.getRecentDebriefs(username, 1);
    
    if (!recentDebriefs || recentDebriefs.length === 0) {
      await this.#messagingGateway.sendMessage(
        conversationId,
        "No debrief data found."
      );
      return { handled: true, action: 'show_details', empty: true };
    }
    
    const debrief = recentDebriefs[0];
    const sources = debrief.sources || [];
    
    if (sources.length === 0) {
      await this.#messagingGateway.sendMessage(
        conversationId,
        "No detailed data sources available for this debrief."
      );
      return { handled: true, action: 'show_details', empty: true };
    }

    // Build source picker keyboard (inline)
    const keyboardMarkup = SendMorningDebrief.buildSourcePickerKeyboard(sources);

    // Update existing message keyboard if messageId provided, otherwise send new message
    if (messageId) {
      // updateKeyboard expects the choices array for inline keyboard
      await this.#messagingGateway.updateKeyboard(
        conversationId,
        messageId,
        keyboardMarkup.inline_keyboard
      );
    } else {
      await this.#messagingGateway.sendMessage(
        conversationId,
        "Select a data source to view details:",
        { reply_markup: keyboardMarkup }
      );
    }

    // Update state to source picker mode, store debrief date
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      subFlow: 'source_picker',
      debriefDate: debrief.date
    });

    this.#logger.info('debrief.show-details', {
      conversationId,
      sources: sources.length
    });

    return { handled: true, action: 'show_details', sources };
  }

  /**
   * Handle "Ask Me" - start interview flow with questions
   */
  async #handleAskMe(conversationId, state) {
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
      await this.#messagingGateway.sendMessage(
        conversationId,
        "What stood out most about yesterday?",
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🎲 Different question', callback_data: 'journal:change' }],
              [{ text: '✅ Done', callback_data: 'journal:done' }]
            ]
          }
        }
      );
      
      return { handled: true, action: 'ask_me', fallback: true };
    }

    // Ask the first question
    const question = selectedQuestions[0];
    
    await this.#messagingGateway.sendMessage(
      conversationId,
      `${selectedCategory.icon} ${question}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🎲 Different question', callback_data: 'journal:change' }],
            [{ text: '⏭️ Skip', callback_data: 'journal:skip' }],
            [{ text: '✅ Done', callback_data: 'journal:done' }]
          ]
        }
      }
    );

    // Update state to interview mode
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      subFlow: 'interview',
      currentCategory: selectedCategory.key,
      currentQuestionIndex: 0,
      askedCategories: [selectedCategory.key]
    });

    this.#logger.info('debrief.ask-me.started', {
      conversationId,
      category: selectedCategory.key,
      question
    });

    return { handled: true, action: 'ask_me', category: selectedCategory.key };
  }

  /**
   * Handle "Accept" - remove keyboard, mark complete
   */
  async #handleAccept(conversationId, state) {
    // Send confirmation with keyboard removed
    await this.#messagingGateway.sendMessage(
      conversationId,
      "✓ Got it. Feel free to write anything on your mind, or just go about your day.",
      {
        reply_markup: { remove_keyboard: true }
      }
    );

    // Update state - debrief accepted but conversation still open
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      activeFlow: 'free_write',
      debriefAccepted: true,
      acceptedAt: new Date().toISOString()
    });

    this.#logger.info('debrief.accepted', {
      conversationId,
      date: state.debrief?.date
    });

    return { handled: true, action: 'accept' };
  }
}
