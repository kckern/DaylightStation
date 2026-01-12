/**
 * Handle Help Command Use Case
 * @module nutribot/usecases/HandleHelpCommand
 *
 * Sends the help message with available commands.
 */

/**
 * Handle help command use case
 */
export class HandleHelpCommand {
  #messagingGateway;
  #logger;

  constructor(deps) {
    if (!deps.messagingGateway) throw new Error('messagingGateway is required');
    this.#messagingGateway = deps.messagingGateway;
    this.#logger = deps.logger || console;
  }

  /**
   * Execute the use case
   */
  async execute(input) {
    const { conversationId } = input;

    this.#logger.debug?.('command.help', { conversationId });

    const helpMessage = `📱 <b>NutriBot Commands</b>

📸 Send a <b>photo</b> of food to log it
📝 Type a <b>food description</b>
🎤 Send a <b>voice message</b>
🔢 Send a <b>UPC barcode</b>

<b>Commands:</b>
/help - This message
/report - Today's nutrition report
/review - Review and adjust entries
/coach - Get personalized advice

<b>Tips:</b>
• Be specific about portions (e.g., "2 cups of rice")
• Include cooking method (e.g., "grilled chicken")
• Log as you eat for best accuracy`;

    const { messageId } = await this.#messagingGateway.sendMessage(
      conversationId,
      helpMessage,
      { parseMode: 'HTML' }
    );

    return { success: true, messageId };
  }
}

export default HandleHelpCommand;
