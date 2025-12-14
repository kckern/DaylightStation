/**
 * Handle Slash Command Use Case
 * @module journalist/application/usecases/HandleSlashCommand
 * 
 * Routes slash commands to appropriate use cases.
 */

import { createLogger } from '../../../_lib/logging/index.mjs';

/**
 * Handle slash command use case
 */
export class HandleSlashCommand {
  #initiateJournalPrompt;
  #generateTherapistAnalysis;
  #reviewJournalEntries;
  #sendQuizQuestion;
  #logger;

  constructor(deps) {
    this.#initiateJournalPrompt = deps.initiateJournalPrompt;
    this.#generateTherapistAnalysis = deps.generateTherapistAnalysis;
    this.#reviewJournalEntries = deps.reviewJournalEntries;
    this.#sendQuizQuestion = deps.sendQuizQuestion;
    this.#logger = deps.logger || createLogger({ source: 'usecase', app: 'journalist' });
  }

  /**
   * Execute the use case
   * @param {Object} input
   * @param {string} input.chatId
   * @param {string} input.command - Command with or without leading /
   */
  async execute(input) {
    const { chatId, command } = input;

    // Parse command (strip leading /)
    const cmd = command.replace(/^\//, '').toLowerCase().trim();
    const [baseCmd, ...args] = cmd.split(/\s+/);

    this.#logger.debug('command.slash.start', { chatId, command: baseCmd });

    try {
      let result;

      switch (baseCmd) {
        case 'journal':
        case 'prompt':
        case 'start':
          if (this.#initiateJournalPrompt) {
            result = await this.#initiateJournalPrompt.execute({ chatId });
          }
          break;

        case 'analyze':
        case 'analysis':
        case 'therapist':
          if (this.#generateTherapistAnalysis) {
            result = await this.#generateTherapistAnalysis.execute({ chatId });
          }
          break;

        case 'review':
        case 'history':
          if (this.#reviewJournalEntries) {
            result = await this.#reviewJournalEntries.execute({ chatId });
          }
          break;

        case 'quiz':
          if (this.#sendQuizQuestion) {
            const category = args[0]; // Optional category
            result = await this.#sendQuizQuestion.execute({ chatId, category });
          }
          break;

        case 'yesterday':
          if (this.#initiateJournalPrompt) {
            result = await this.#initiateJournalPrompt.execute({ 
              chatId, 
              instructions: 'yesterday',
            });
          }
          break;

        default:
          // Default to journal prompt
          if (this.#initiateJournalPrompt) {
            result = await this.#initiateJournalPrompt.execute({ chatId });
          }
          break;
      }

      if (!result) {
        result = { success: false, error: 'Command handler not available' };
      }

      this.#logger.info('command.slash.complete', { 
        chatId, 
        command: baseCmd, 
        success: result.success,
      });

      return {
        ...result,
        command: baseCmd,
      };
    } catch (error) {
      this.#logger.error('command.slash.error', { chatId, command: baseCmd, error: error.message });
      throw error;
    }
  }
}

export default HandleSlashCommand;
