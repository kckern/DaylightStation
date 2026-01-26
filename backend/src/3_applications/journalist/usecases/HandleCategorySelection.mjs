/**
 * Handle Category Selection Use Case
 * @module journalist/usecases/HandleCategorySelection
 *
 * Handles when user selects a category from the morning debrief keyboard
 */

/**
 * Handle category selection from debrief
 */
export class HandleCategorySelection {
  #messagingGateway;
  #conversationStateStore;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
   * @param {Object} deps.conversationStateStore - State persistence
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
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
    };
  }

  /**
   * Execute category selection handling
   *
   * @param {Object} input
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.messageText - User's message (category name)
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Object} Result
   */
  async execute(input) {
    const { conversationId, messageText, responseContext } = input;

    const messaging = this.#getMessaging(responseContext, conversationId);

    this.#logger.info?.('debrief.category-selection.start', {
      conversationId,
      messageText,
    });

    try {
      // Get debrief state
      const state = await this.#conversationStateStore.get(conversationId);

      if (!state || state.activeFlow !== 'morning_debrief' || !state.debrief) {
        this.#logger.warn?.('debrief.category-selection.no-active-debrief', { conversationId });
        return { success: false, reason: 'no_active_debrief' };
      }

      // Handle skip
      if (messageText.includes('Skip') || messageText.includes('⏭️')) {
        await this.#conversationStateStore.delete(conversationId);
        await messaging.sendMessage(
          "No worries! I'm here whenever you want to journal. Have a great day! 🌟",
        );

        this.#logger.info?.('debrief.skipped', { conversationId });
        return { success: true, skipped: true };
      }

      // Determine selected category
      const category = this.#matchCategory(messageText, state.debrief.categories);

      if (!category) {
        this.#logger.warn?.('debrief.category-selection.no-match', {
          conversationId,
          messageText,
          availableCategories: state.debrief.categories?.map((c) => c.key) || [],
        });

        // Treat as free-form input
        await this.#handleFreeformEntry(conversationId, messageText, state, messaging);
        return { success: true, freeform: true };
      }

      // Get questions for this category
      const questions = state.debrief.questions?.[category.key] || [];
      const question = questions[0] || 'Tell me more about that.';

      // Send question
      await messaging.sendMessage(`💭 ${question}`, {
        reply_markup: {
          remove_keyboard: true,
        },
      });

      // Update state to track category
      await this.#conversationStateStore.set(conversationId, {
        ...state,
        activeFlow: 'journal_entry',
        context: {
          debrief: state.debrief,
          selectedCategory: category.key,
          remainingQuestions: questions.slice(1),
        },
      });

      this.#logger.info?.('debrief.category-selected', {
        conversationId,
        category: category.key,
      });

      return {
        success: true,
        category: category.key,
        question,
      };
    } catch (error) {
      this.#logger.error?.('debrief.category-selection.failed', {
        conversationId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Match user's text to a category
   */
  #matchCategory(text, categories) {
    const normalized = text.toLowerCase();

    // Try exact icon match first
    const iconMatch = categories.find((c) => text.includes(c.icon));
    if (iconMatch) return iconMatch;

    // Try key word match
    const keywordMatches = {
      events: ['events', 'people', 'calendar', 'meeting'],
      health: ['health', 'fitness', 'workout', 'exercise'],
      media: ['media', 'culture', 'movie', 'music', 'book'],
      tasks: ['task', 'work', 'todo', 'project'],
      thoughts: ['thought', 'reflection', 'feeling'],
      freewrite: ['free', 'write', 'journal'],
    };

    for (const [key, keywords] of Object.entries(keywordMatches)) {
      if (keywords.some((kw) => normalized.includes(kw))) {
        return categories.find((c) => c.key === key);
      }
    }

    return null;
  }

  /**
   * Handle free-form entry (user typed instead of selecting category)
   * @param {Object} messaging - Messaging interface
   */
  async #handleFreeformEntry(conversationId, text, state, messaging) {
    // Acknowledge the entry
    await messaging.sendMessage(
      "Thanks for sharing that. Anything else on your mind? (or type 'done' to finish)",
    );

    // Update state
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      activeFlow: 'journal_entry',
      context: {
        debrief: state.debrief,
        selectedCategory: 'freewrite',
        firstEntry: text,
      },
    });

    this.#logger.info?.('debrief.freeform-entry', { conversationId });
  }
}

export default HandleCategorySelection;
