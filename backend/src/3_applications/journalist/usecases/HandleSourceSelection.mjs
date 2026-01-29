/**
 * Handle Source Selection Use Case
 * @module journalist/usecases/HandleSourceSelection
 *
 * Handles source picker buttons from "Show Details":
 * - Source buttons (🏋️ activity, 💻 code, etc.) → Dump raw summary
 * - ← Back → Return to main debrief keyboard
 */

import { getSourceIcon } from './SendMorningDebrief.mjs';

/**
 * Handle source selection buttons
 */
export class HandleSourceSelection {
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
   * Execute handling a source selection
   *
   * @param {Object} input
   * @param {string} input.conversationId - Conversation ID
   * @param {string} input.text - Button text that was pressed
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Object} Result
   */
  async execute(input) {
    const { conversationId, text, responseContext } = input;

    const messaging = this.#getMessaging(responseContext, conversationId);

    // Get current state
    const state = await this.#conversationStateStore.get(conversationId);
    if (!state || state.subFlow !== 'source_picker') {
      return { handled: false };
    }

    this.#logger.info?.('debrief.source.selected', {
      conversationId,
      text,
    });

    // Handle back button
    if (text === '← Back') {
      return this.#handleBack(conversationId, state, messaging);
    }

    // Try to match a source button
    const sourceName = this.#extractSourceName(text);
    if (sourceName) {
      return this.#handleSourceDump(conversationId, state, sourceName, messaging);
    }

    return { handled: false };
  }

  /**
   * Extract source name from button text like "🏋️ strava"
   * Button format is always: "emoji source_name"
   */
  #extractSourceName(text) {
    // Button text format: "emoji source_name"
    // Split on first space to get source name
    const parts = text.split(' ');
    if (parts.length >= 2) {
      // Everything after first space is the source name
      return parts.slice(1).join(' ');
    }

    return null;
  }

  /**
   * Handle source dump - show raw summary for selected source
   * @param {Object} messaging - Messaging interface
   */
  async #handleSourceDump(conversationId, state, sourceName, messaging) {
    const summaries = state.debrief?.summaries || [];

    // Find the summary for this source
    const sourceSummary = summaries.find((s) => s.source === sourceName);

    if (!sourceSummary || !sourceSummary.text) {
      await messaging.sendMessage(
        `No detailed data available for ${sourceName}.`,
      );
      return { handled: true, action: 'source_dump', source: sourceName, empty: true };
    }

    // Send the raw summary
    const icon = getSourceIcon(sourceName);
    await messaging.sendMessage(
      `${icon} *${sourceName.toUpperCase()}*\n\n${sourceSummary.text}`,
      { parse_mode: 'Markdown' },
    );

    this.#logger.info?.('debrief.source.dumped', {
      conversationId,
      source: sourceName,
      length: sourceSummary.text.length,
    });

    return { handled: true, action: 'source_dump', source: sourceName };
  }

  /**
   * Handle back button - return to main debrief keyboard
   * @param {Object} messaging - Messaging interface
   */
  async #handleBack(conversationId, state, messaging) {
    // Restore main 3-button keyboard
    await messaging.sendMessage('Back to main options:', {
      reply_markup: {
        keyboard: [
          [{ text: '📊 Show Details' }, { text: '💬 Ask Me' }, { text: '✅ Accept' }],
        ],
        resize_keyboard: true,
        one_time_keyboard: false,
        input_field_placeholder: 'Choose an action or type freely...',
      },
    });

    // Update state - back to main debrief flow
    await this.#conversationStateStore.set(conversationId, {
      ...state,
      subFlow: null,
    });

    this.#logger.info?.('debrief.source.back', { conversationId });

    return { handled: true, action: 'back' };
  }
}

export default HandleSourceSelection;
