/**
 * CLI Presenter
 * @module cli/presenters/CLIPresenter
 * 
 * Handles all terminal output formatting for the chat simulator.
 */

import chalk from 'chalk';

/**
 * CLI Presenter - formats and displays output to terminal
 */
export class CLIPresenter {
  #options;

  constructor(options = {}) {
    this.#options = {
      botColor: options.botColor || 'cyan',
      userColor: options.userColor || 'green',
      systemColor: options.systemColor || 'gray',
      errorColor: options.errorColor || 'red',
      width: options.width || process.stdout.columns || 80,
    };
  }

  // ==================== Bot Messages ====================

  /**
   * Print a message from the bot
   * @param {string} text - Message text (may contain markdown)
   * @param {Object} [options]
   * @param {string} [options.botName] - Name of the bot
   * @param {string} [options.emoji] - Emoji prefix
   */
  printBotMessage(text, options = {}) {
    const { botName = 'Bot', emoji = '🤖' } = options;
    const prefix = chalk[this.#options.botColor].bold(`${emoji} ${botName}:`);
    
    console.log();
    console.log(prefix);
    
    // Format the message text
    const formatted = this.#formatMarkdown(text);
    const indented = this.#indent(formatted, 3);
    console.log(indented);
  }

  /**
   * Print a user's message
   * @param {string} text
   */
  printUserMessage(text) {
    console.log();
    console.log(chalk[this.#options.userColor](`👤 You: ${text}`));
  }

  /**
   * Print a system message (dim, informational)
   * @param {string} text
   */
  printSystemMessage(text) {
    console.log(chalk[this.#options.systemColor](`   ℹ️  ${text}`));
  }

  /**
   * Print an error message
   * @param {string} text
   */
  printError(text) {
    console.log(chalk[this.#options.errorColor].bold(`   ❌ Error: ${text}`));
  }

  /**
   * Print a warning message
   * @param {string} text
   */
  printWarning(text) {
    console.log(chalk.yellow(`   ⚠️  ${text}`));
  }

  /**
   * Print a success message
   * @param {string} text
   */
  printSuccess(text) {
    console.log(chalk.green(`   ✅ ${text}`));
  }

  // ==================== Visual Elements ====================

  /**
   * Print a horizontal divider
   */
  printDivider() {
    const width = Math.min(this.#options.width - 4, 60);
    console.log(chalk.gray('─'.repeat(width)));
  }

  /**
   * Print a header box
   * @param {string} title
   * @param {string} [subtitle]
   */
  printHeader(title, subtitle) {
    const width = Math.min(this.#options.width - 4, 60);
    
    console.log();
    console.log(chalk.cyan('┌' + '─'.repeat(width - 2) + '┐'));
    console.log(chalk.cyan('│') + chalk.cyan.bold(this.#centerText(title, width - 2)) + chalk.cyan('│'));
    if (subtitle) {
      console.log(chalk.cyan('│') + chalk.gray(this.#centerText(subtitle, width - 2)) + chalk.cyan('│'));
    }
    console.log(chalk.cyan('└' + '─'.repeat(width - 2) + '┘'));
    console.log();
  }

  /**
   * Print the welcome banner
   * @param {string} botName
   * @param {string} sessionId
   */
  printWelcome(botName, sessionId) {
    this.printHeader(`${botName} - CLI Mode`, `Session: ${sessionId}`);
    console.log(chalk.gray('   Type /help for commands, /switch to change bot'));
    this.printDivider();
  }

  /**
   * Print the main menu
   */
  printMainMenu() {
    console.clear();
    this.printHeader('🤖 Chatbot CLI Simulator', 'Select a chatbot to begin');
  }

  /**
   * Clear the screen
   */
  clearScreen() {
    console.clear();
  }

  /**
   * Print an empty line
   */
  printNewline() {
    console.log();
  }

  // ==================== Food/Nutrition Specific ====================

  /**
   * Print a food item list
   * @param {Array} items - Food items
   */
  printFoodItems(items) {
    if (!items || items.length === 0) {
      console.log(chalk.gray('   (no items)'));
      return;
    }

    items.forEach((item, index) => {
      const name = item.name || item.label || 'Unknown';
      const qty = item.quantity || item.amount || 1;
      const unit = item.unit || '';
      const cals = item.calories || 0;
      const color = item.color || 'yellow';
      
      const colorEmoji = { green: '🟢', yellow: '🟡', orange: '🟠' }[color] || '⚪';
      
      console.log(chalk.white(`   ${colorEmoji} ${name} (${qty}${unit}) - ${cals} cal`));
    });
  }

  /**
   * Print nutrition totals
   * @param {Object} totals
   */
  printNutritionTotals(totals) {
    const { calories = 0, protein = 0, carbs = 0, fat = 0 } = totals;
    
    console.log();
    console.log(chalk.white.bold('   📊 Totals:'));
    console.log(chalk.white(`      Calories: ${calories} cal`));
    console.log(chalk.cyan(`      Protein:  ${protein}g`));
    console.log(chalk.yellow(`      Carbs:    ${carbs}g`));
    console.log(chalk.magenta(`      Fat:      ${fat}g`));
  }

  // ==================== Media ====================

  /**
   * Print ASCII art image frame (INTERNAL - use printPhotoMessage for image messages)
   * @private
   * @param {string} [emoji='🏞️'] - Emoji to show in the frame
   */
  #printImageFrame(emoji = '🏞️') {
    console.log(chalk.gray('   .--------------------------.'));
    console.log(chalk.gray('   |                          |'));
    console.log(chalk.gray('   |      .-----------.       |'));
    console.log(chalk.gray('   |      |           |       |'));
    console.log(chalk.gray('   |      |     ') + emoji + chalk.gray('    |       |'));
    console.log(chalk.gray('   |      |           |       |'));
    console.log(chalk.gray('   |      \'-----------\'       |'));
    console.log(chalk.gray('   |                          |'));
    console.log(chalk.gray('   \'--------------------------\''));
  }

  /**
   * Print a photo/image message (CLI representation of an image attachment)
   * This is the ONLY way to display image messages in CLI.
   * 
   * @param {Object} options
   * @param {string} [options.caption] - Caption text (can be multi-line)
   * @param {string} [options.emoji='📷'] - Emoji for the frame
   * @param {string} [options.botName='Bot'] - Bot name
   * @param {string} [options.botEmoji='🤖'] - Bot emoji
   * @param {string} options.filePath - Path to the image file (required)
   */
  printPhotoMessage(options = {}) {
    const { 
      caption = '', 
      emoji = '📷', 
      botName = 'Bot', 
      botEmoji = '🤖',
      filePath = null,
    } = options;

    // Print bot attribution
    const prefix = chalk[this.#options.botColor].bold(`${botEmoji} ${botName}:`);
    console.log();
    console.log(prefix);

    // Print the image frame
    this.#printImageFrame(emoji);

    // Show file path (required for image messages)
    if (filePath) {
      console.log(chalk.gray(`   📎 ${filePath}`));
    }

    // Print caption below if present
    if (caption) {
      const lines = caption.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          console.log(chalk.white(`   ${line}`));
        }
      }
    }
  }

  /**
   * Print image saved notification
   * @param {string} path - File path
   */
  printImageSaved(path) {
    console.log();
    console.log(chalk.blue(`   🖼️  Image saved: ${chalk.underline(path)}`));
  }

  /**
   * Print that we're processing/thinking
   * @param {string} [message]
   */
  printThinking(message = 'Processing...') {
    process.stdout.write(chalk.gray(`   ⏳ ${message}`));
  }

  /**
   * Clear the thinking indicator
   */
  clearThinking() {
    process.stdout.clearLine?.(0);
    process.stdout.cursorTo?.(0);
  }

  // ==================== Choices/Buttons ====================

  /**
   * Format choices for display before inquirer selection
   * @param {Array} choices - 2D array of button rows
   * @returns {Array} - Flattened choices for inquirer
   */
  formatChoicesForInquirer(choices) {
    if (!choices || choices.length === 0) return [];

    const flattened = [];
    
    for (const row of choices) {
      for (const button of row) {
        flattened.push({
          name: button.text,
          value: button.callback_data,
        });
      }
    }

    return flattened;
  }

  /**
   * Print choices preview (before selection)
   * @param {Array} choices
   */
  printChoicesPreview(choices) {
    if (!choices || choices.length === 0) return;

    console.log();
    console.log(chalk.gray('   Available actions:'));
    
    for (const row of choices) {
      const rowText = row.map(b => `[${b.text}]`).join('  ');
      console.log(chalk.gray(`   ${rowText}`));
    }
  }

  /**
   * Print non-blocking button bar with IDs
   * @param {Array<{ id: string, label: string }>} buttons
   */
  printButtonBar(buttons) {
    if (!buttons || buttons.length === 0) return;

    console.log();
    const buttonText = buttons.map(b => `[${chalk.cyan(b.id)}] ${b.label}`).join('  ');
    console.log(`   ${buttonText}`);
  }

  // ==================== Help ====================

  /**
   * Print help information
   */
  printHelp() {
    console.log();
    console.log(chalk.cyan.bold('   📚 General Commands:'));
    console.log();
    console.log(chalk.white('   /help     ') + chalk.gray('- Show this help message'));
    console.log(chalk.white('   /switch   ') + chalk.gray('- Switch to another chatbot'));
    console.log(chalk.white('   /clear    ') + chalk.gray('- Clear conversation history'));
    console.log(chalk.white('   /state    ') + chalk.gray('- Show current conversation state'));
    console.log(chalk.white('   /debug    ') + chalk.gray('- Toggle debug logging'));
    console.log(chalk.white('   /quit     ') + chalk.gray('- Exit the CLI'));
    console.log();
    console.log(chalk.cyan.bold('   🍎 NutriBot Actions:'));
    console.log();
    console.log(chalk.white('   /accept   ') + chalk.gray('- Accept the most recent pending log'));
    console.log(chalk.white('   /revise   ') + chalk.gray('- Revise the most recent pending log'));
    console.log(chalk.white('   /discard  ') + chalk.gray('- Discard the most recent pending log'));
    console.log(chalk.white('   /report   ') + chalk.gray('- Show today\'s nutrition report'));
    console.log();
    console.log(chalk.cyan.bold('   🔘 Button Presses:'));
    console.log();
    console.log(chalk.white('   1-9, 0, A-Z ') + chalk.gray('- Press button by ID (shown as [1], [2], etc.)'));
    console.log(chalk.gray('   Type the single character to press that button.'));
    console.log(chalk.gray('   Multiple pending logs can have buttons - most recent ID wins.'));
    console.log();
    console.log(chalk.cyan.bold('   📸 Simulated Inputs:'));
    console.log();
    console.log(chalk.white('   [photo:/path/to/image.jpg]  ') + chalk.gray('- Simulate photo'));
    console.log(chalk.white('   [voice:text to transcribe]  ') + chalk.gray('- Simulate voice'));
    console.log(chalk.white('   [upc:012345678901]          ') + chalk.gray('- Simulate barcode scan'));
    console.log();
  }

  // ==================== Private Helpers ====================

  /**
   * Format markdown text for terminal
   * @private
   */
  #formatMarkdown(text) {
    if (!text) return '';

    let formatted = text;

    // Bold: **text** or <b>text</b>
    formatted = formatted.replace(/\*\*([^*]+)\*\*/g, chalk.bold('$1'));
    formatted = formatted.replace(/<b>([^<]+)<\/b>/gi, chalk.bold('$1'));

    // Italic: *text* or _text_ or <i>text</i>
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, chalk.italic('$1'));
    formatted = formatted.replace(/_([^_]+)_/g, chalk.italic('$1'));
    formatted = formatted.replace(/<i>([^<]+)<\/i>/gi, chalk.italic('$1'));

    // Code: `text`
    formatted = formatted.replace(/`([^`]+)`/g, chalk.bgGray.white(' $1 '));

    // Links: remove HTML tags
    formatted = formatted.replace(/<[^>]+>/g, '');

    // Bullet points
    formatted = formatted.replace(/^• /gm, '  • ');
    formatted = formatted.replace(/^- /gm, '  • ');

    return formatted;
  }

  /**
   * Indent text
   * @private
   */
  #indent(text, spaces = 3) {
    const indent = ' '.repeat(spaces);
    return text.split('\n').map(line => indent + line).join('\n');
  }

  /**
   * Center text within a width
   * @private
   */
  #centerText(text, width) {
    const padding = Math.max(0, Math.floor((width - text.length) / 2));
    return ' '.repeat(padding) + text + ' '.repeat(width - padding - text.length);
  }
}

export default CLIPresenter;
