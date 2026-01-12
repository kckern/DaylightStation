/**
 * Handle Source Selection Use Case
 * @module journalist/usecases/HandleSourceSelection
 *
 * Handles source picker buttons from "Show Details":
 * - Source buttons (🏋️ strava, 💻 github, etc.) → Dump raw summary
 * - ← Back → Return to main debrief keyboard
 */

import { SOURCE_ICONS } from './SendMorningDebrief.mjs';

/**
 * Handle source selection buttons
 */
export class HandleSourceSelection {
  #messagingGateway;
  #conversationStateStore;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.messagingGateway - Telegram gateway
   * @param {Object} deps.conversationStateStore - State persistence
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute handling a source selection
   *
   * @param {Object} input
   * @param {string} input.conversationId - Telegram conversation ID
   * @param {string} input.text - Button text that was pressed
   * @returns {Object} Result
   */
  async execute(input) {
    const { conversationId, text } = input;

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
      return this.#handleBack(conversationId, state);
    }

    // Try to match a source button
    const sourceName = this.#extractSourceName(text);
    if (sourceName) {
      return this.#handleSourceDump(conversationId, state, sourceName);
    }

    return { handled: false };
  }

  /**
   * Extract source name from button text like "🏋️ strava"
   */
  #extractSourceName(text) {
    // Try matching known patterns
    for (const [source, icon] of Object.entries(SOURCE_ICONS)) {
      if (text === `${icon} ${source}`) {
        return source;
      }
    }

    // Try matching with 📄 default icon
    if (text.startsWith('📄 ')) {
      return text.slice(3);
    }

    return null;
  }

  /**
   * Handle source dump - show raw summary for selected source
   */
  async #handleSourceDump(conversationId, state, sourceName) {
    const summaries = state.debrief?.summaries || [];

    // Find the summary for this source
    const sourceSummary = summaries.find((s) => s.source === sourceName);

    if (!sourceSummary || !sourceSummary.text) {
      await this.#messagingGateway.sendMessage(
        conversationId,
        `No detailed data available for ${sourceName}.`,
      );
      return { handled: true, action: 'source_dump', source: sourceName, empty: true };
    }

    // Send the raw summary
    const icon = SOURCE_ICONS[sourceName] || '📄';
    await this.#messagingGateway.sendMessage(
      conversationId,
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
   */
  async #handleBack(conversationId, state) {
    // Restore main 3-button keyboard
    await this.#messagingGateway.sendMessage(conversationId, 'Back to main options:', {
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
