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
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.command - Command with or without leading /
   * @param {string} [input.userId] - User ID for debrief
   */
  async execute(input) {
    const { chatId, command, userId } = input;

    // Parse command (strip leading /)
    const cmd = command.replace(/^\//, '').toLowerCase().trim();
    const [baseCmd] = cmd.split(/\s+/);

    this.#logger.debug?.('command.slash.start', { chatId, command: baseCmd });

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
            });
          }
          break;

        case 'yesterday':
          // Trigger morning debrief - need to generate first, then send
          if (this.#generateMorningDebrief && this.#sendMorningDebrief) {
            // Step 1: Generate the debrief
            const debrief = await this.#generateMorningDebrief.execute({
              username: userId || 'kckern', // TODO: proper user resolution
              date: null, // defaults to yesterday
            });

            // Step 2: Send to Telegram
            result = await this.#sendMorningDebrief.execute({
              conversationId: chatId,
              debrief,
            });
          } else {
            // Fallback message if debrief not available
            if (this.#messagingGateway) {
              await this.#messagingGateway.sendMessage(
                chatId,
                '📅 Morning debrief is not configured yet.',
                {},
              );
            }
            result = { success: false, error: 'Debrief not available' };
          }
          break;

        case 'counsel':
        case 'therapist':
        case 'analyze':
          // Therapist-style analysis
          if (this.#generateTherapistAnalysis) {
            result = await this.#generateTherapistAnalysis.execute({ chatId });
          }
          break;

        default:
          // Unknown command - show help
          if (this.#messagingGateway) {
            await this.#messagingGateway.sendMessage(
              chatId,
              '📝 Available commands:\n' +
                '/prompt - Start a new conversation topic\n' +
                "/yesterday - Review yesterday's activities\n" +
                '/counsel - Get insights and observations',
              {},
            );
          }
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
