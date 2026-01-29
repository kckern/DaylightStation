/**
 * Send Morning Debrief Use Case
 * @module journalist/usecases/SendMorningDebrief
 *
 * Sends the generated debrief to the user via messaging gateway with reply keyboard
 */

import { nowTs24 } from '#system/utils/index.mjs';

// Source icon mapping - uses generic category names
// Vendor sources are mapped via SOURCE_CATEGORY_MAP
const SOURCE_ICONS = {
  activity: '🏋️',    // was: strava
  fitness: '🏃',
  weight: '⚖️',
  events: '📆',
  code: '💻',         // was: github
  checkins: '📍',
  social: '💬',       // was: reddit
};

// Maps vendor source names to generic category keys
const SOURCE_CATEGORY_MAP = {
  strava: 'activity',
  github: 'code',
  reddit: 'social',
};

/**
 * Get icon for a source (handles vendor-to-generic mapping)
 * @param {string} source - Source name (may be vendor-specific)
 * @returns {string} Icon emoji
 */
function getSourceIcon(source) {
  const category = SOURCE_CATEGORY_MAP[source] || source;
  return SOURCE_ICONS[category] || '📄';
}

/**
 * Send morning debrief to user
 */
export class SendMorningDebrief {
  #messagingGateway;
  #conversationStateStore;
  #debriefRepository;
  #journalEntryRepository;
  #logger;

  /**
   * @param {Object} deps
   * @param {Object} deps.messagingGateway - Messaging gateway for sending messages
   * @param {Object} deps.conversationStateStore - State persistence
   * @param {Object} deps.debriefRepository - Debrief persistence
   * @param {Object} deps.logger - Logger instance
   */
  constructor(deps) {
    this.#messagingGateway = deps.messagingGateway;
    this.#conversationStateStore = deps.conversationStateStore;
    this.#debriefRepository = deps.debriefRepository;
    this.#journalEntryRepository = deps.journalEntryRepository;
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
   * Execute sending the debrief
   *
   * @param {Object} input
   * @param {string} input.conversationId - Conversation ID
   * @param {Object} input.debrief - Generated debrief data
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   * @returns {Object} Result with message ID
   */
  async execute(input) {
    const { conversationId, debrief, responseContext } = input;

    this.#logger.info?.('debrief.send.start', {
      conversationId,
      success: debrief.success,
      date: debrief.date,
      hasResponseContext: !!responseContext,
    });

    const messaging = this.#getMessaging(responseContext, conversationId);

    try {
      // Handle fallback case (insufficient data or error)
      if (!debrief.success) {
        const message = debrief.fallbackPrompt;
        const result = await messaging.sendMessage(message);

        this.#logger.info?.('debrief.sent-fallback', {
          conversationId,
          reason: debrief.reason,
          messageId: result.messageId,
        });

        return {
          success: true,
          messageId: result.messageId,
          fallback: true,
        };
      }

      // Build full message with summary (no "What would you like..." - buttons are self-explanatory)
      // Format date as "Mon, 1 Jan 2025"
      const dateObj = new Date(debrief.date + 'T00:00:00');
      const formattedDate = dateObj.toLocaleDateString('en-US', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });

      const message = `📅 Yesterday (${formattedDate})

${debrief.summary}`;

      // Build main 3-button keyboard
      const keyboard = this.#buildMainKeyboard();

      // Send message with keyboard
      const result = await messaging.sendMessage(message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });

      // Validate result before proceeding
      if (!result || !result.messageId) {
        throw new Error('Failed to send message - no message ID returned');
      }

      // Save to journal history
      if (this.#journalEntryRepository) {
        await this.#journalEntryRepository.saveMessage({
          id: result.messageId,
          chatId: conversationId,
          role: 'assistant',
          content: message,
          senderId: 'bot',
          senderName: 'Journalist',
        });
      }

      // Store debrief state for later retrieval (including lifelog for source dumps)
      if (!this.#conversationStateStore) {
        this.#logger.warn?.('debrief.send.no-state-store', { conversationId });
      } else {
        await this.#conversationStateStore.set(conversationId, {
          activeFlow: 'morning_debrief',
          debrief: {
            date: debrief.date,
            summary: debrief.summary,
            questions: debrief.questions,
            categories: debrief.categories,
            sources: debrief.lifelog?._meta?.sources || [],
            summaries: debrief.lifelog?.summaries || [],
          },
          messageId: result.messageId,
        });
      }

      // Persist debrief to debriefs.yml (without questions - generated on-demand)
      if (this.#debriefRepository) {
        try {
          await this.#debriefRepository.appendDebrief({
            date: debrief.date,
            timestamp: nowTs24(),
            summary: debrief.summary,
            categories: debrief.categories,
            sources: debrief.lifelog?._meta?.sources || [],
            summaries: debrief.lifelog?.summaries || {}, // Save source summaries for Details view
          });
        } catch (error) {
          // Log but don't fail the whole operation
          this.#logger.error?.('debrief.persist-error', {
            date: debrief.date,
            error: error.message,
          });
        }
      }

      this.#logger.info?.('debrief.sent', {
        conversationId,
        date: debrief.date,
        messageId: result.messageId,
        sources: debrief.lifelog?._meta?.sources?.length || 0,
      });

      return {
        success: true,
        messageId: result.messageId,
        fallback: false,
      };
    } catch (error) {
      this.#logger.error?.('debrief.send.failed', {
        conversationId,
        error: error.message,
        stack: error.stack,
      });

      throw error;
    }
  }

  /**
   * Build main 3-button inline keyboard (attached to message)
   */
  #buildMainKeyboard() {
    return {
      inline_keyboard: [
        [
          { text: '📊 Details', callback_data: 'debrief:details' },
          { text: '💬 Ask', callback_data: 'debrief:ask' },
          { text: '✅ OK', callback_data: 'debrief:accept' },
        ],
      ],
    };
  }

  /**
   * Build source picker keyboard (used by HandleDebriefResponse)
   * @param {Array} sources - Available source names
   * @returns {Object} Inline keyboard markup
   */
  static buildSourcePickerKeyboard(sources) {
    const keyboard = [];

    // Normalize sources - handle both string array and object array formats
    const sourceNames = sources
      .map((s) => (typeof s === 'string' ? s : s?.source))
      .filter(Boolean);

    // Build rows of 3 buttons each with callback data
    for (let i = 0; i < sourceNames.length; i += 3) {
      const row = sourceNames.slice(i, i + 3).map((source) => ({
        text: `${getSourceIcon(source)} ${source}`,
        callback_data: `debrief:source:${source}`,
      }));
      keyboard.push(row);
    }

    // Add back button
    keyboard.push([
      {
        text: '← Back',
        callback_data: 'debrief:back',
      },
    ]);

    return {
      inline_keyboard: keyboard,
    };
  }
}

export { SOURCE_ICONS, SOURCE_CATEGORY_MAP, getSourceIcon };
export default SendMorningDebrief;
