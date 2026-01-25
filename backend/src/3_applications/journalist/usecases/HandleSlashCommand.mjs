/**
 * Handle Slash Command Use Case
 * @module journalist/application/usecases/HandleSlashCommand
 *
 * Routes slash commands to appropriate use cases.
 * Supported commands:
 *   /prompt - Start a new conversation topic
 *   /yesterday - Trigger morning debrief for yesterday
 *   /counsel - Get therapist-style analysis and insights
 */

/**
 * Handle slash command use case
 */
export class HandleSlashCommand {
  #initiateJournalPrompt;
  #generateTherapistAnalysis;
  #generateMorningDebrief;
  #sendMorningDebrief;
  #messagingGateway;
  #logger;

  constructor(deps) {
    this.#initiateJournalPrompt = deps.initiateJournalPrompt;
    this.#generateTherapistAnalysis = deps.generateTherapistAnalysis;
    this.#generateMorningDebrief = deps.generateMorningDebrief;
    this.#sendMorningDebrief = deps.sendMorningDebrief;
    this.#messagingGateway = deps.messagingGateway;
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
      sendMessage: (text, options) => this.#messagingGateway?.sendMessage(chatId, text, options),
    };
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.command - Command with or without leading /
   * @param {string} [input.userId] - User ID for debrief
   * @param {Object} [input.responseContext] - Bound response context for DDD-compliant messaging
   */
  async execute(input) {
    const { chatId, command, userId, responseContext } = input;

    // Parse command (strip leading /)
    const cmd = command.replace(/^\//, '').toLowerCase().trim();
    const [baseCmd] = cmd.split(/\s+/);

    this.#logger.debug?.('command.slash.start', { chatId, command: baseCmd, hasResponseContext: !!responseContext });

    const messaging = this.#getMessaging(responseContext, chatId);

    try {
      let result;

      switch (baseCmd) {
        case 'prompt':
        case 'start':
          // Start a new conversation topic
          if (this.#initiateJournalPrompt) {
            result = await this.#initiateJournalPrompt.execute({
              chatId,
              instructions: 'change_subject',
              responseContext,
            });
          }
          break;

        case 'yesterday':
          // Trigger morning debrief - need to generate first, then send
          if (this.#generateMorningDebrief && this.#sendMorningDebrief) {
            // Step 1: Generate the debrief
            const debrief = await this.#generateMorningDebrief.execute({
              username: userId || 'unknown',
              date: null, // defaults to yesterday
            });

            // Step 2: Send to Telegram
            result = await this.#sendMorningDebrief.execute({
              conversationId: chatId,
              debrief,
              responseContext,
            });
          } else {
            // Fallback message if debrief not available
            await messaging.sendMessage(
              '📅 Morning debrief is not configured yet.',
              {},
            );
            result = { success: false, error: 'Debrief not available' };
          }
          break;

        case 'counsel':
        case 'therapist':
        case 'analyze':
          // Therapist-style analysis
          if (this.#generateTherapistAnalysis) {
            result = await this.#generateTherapistAnalysis.execute({ chatId, responseContext });
          }
          break;

        default:
          // Unknown command - show help
          await messaging.sendMessage(
            '📝 Available commands:\n' +
              '/prompt - Start a new conversation topic\n' +
              "/yesterday - Review yesterday's activities\n" +
              '/counsel - Get insights and observations',
            {},
          );
          result = { success: true, action: 'help' };
          break;
      }

      if (!result) {
        result = { success: false, error: 'Command handler not available' };
      }

      this.#logger.info?.('command.slash.complete', {
        chatId,
        command: baseCmd,
        success: result.success,
      });

      return {
        ...result,
        command: baseCmd,
      };
    } catch (error) {
      this.#logger.error?.('command.slash.error', { chatId, command: baseCmd, error: error.message });
      throw error;
    }
  }
}

export default HandleSlashCommand;
