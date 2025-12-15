/**
 * CLI Input Handler
 * @module cli/input/CLIInputHandler
 * 
 * Handles all user input from the terminal including text, choices, and special commands.
 */

import readline from 'readline';
import { select, input, confirm } from '@inquirer/prompts';
import { createLogger } from '../../_lib/logging/index.mjs';

/**
 * Special input patterns
 */
const SPECIAL_PATTERNS = {
  PHOTO: /^\[photo:(.+)\]$/i,
  VOICE: /^\[voice:(.+)\]$/i,
  UPC: /^\[upc:(\d+)\]$/i,
  COMMAND: /^\/(\w+)(?:\s+(.*))?$/,
  // Image URL (http/https with image extension)
  IMAGE_URL: /^(https?:\/\/[^\s]+\.(jpe?g|png|gif|webp|bmp))(\?.*)?$/i,
  // Local file path with image extension
  IMAGE_PATH: /^(\.{0,2}\/[^\s]+\.(jpe?g|png|gif|webp|bmp))$/i,
  // Base64 data URL for images
  BASE64_IMAGE: /^data:image\/(jpe?g|png|gif|webp|bmp);base64,/i,
};

/**
 * Available CLI commands
 */
const COMMANDS = {
  help: 'Show help information',
  switch: 'Switch to another chatbot',
  clear: 'Clear conversation history',
  state: 'Show current conversation state',
  debug: 'Toggle debug logging',
  quit: 'Exit the CLI',
  exit: 'Exit the CLI',
  // NutriBot action commands
  accept: 'Accept the pending food log',
  revise: 'Revise the pending food log',
  discard: 'Discard the pending food log',
  report: 'Show today\'s nutrition report',
};

/**
 * Input types returned by detectInputType
 */
export const InputType = {
  TEXT: 'text',
  PHOTO: 'photo',
  VOICE: 'voice',
  UPC: 'upc',
  COMMAND: 'command',
  CALLBACK: 'callback',
  BUTTON_PRESS: 'button_press',
};

/**
 * CLI Input Handler
 */
export class CLIInputHandler {
  #presenter;
  #logger;
  #rl;

  /**
   * @param {Object} deps
   * @param {import('../presenters/CLIPresenter.mjs').CLIPresenter} deps.presenter
   * @param {Object} [deps.logger]
   */
  constructor(deps = {}) {
    this.#presenter = deps.presenter;
    this.#logger = deps.logger || createLogger({ source: 'cli:input', app: 'cli' });
  }

  // ==================== Text Input ====================

  /**
   * Prompt for single-line text input
   * @param {string} [prompt='> ']
   * @returns {Promise<string>}
   */
  async promptText(prompt = '> ') {
    try {
      const answer = await input({
        message: prompt,
        theme: {
          prefix: '',
          style: {
            message: (text) => text,
          },
        },
      });
      
      this.#logger.debug('input.text', { text: answer });
      return answer.trim();
    } catch (error) {
      // Handle Ctrl+C gracefully
      if (error.name === 'ExitPromptError') {
        return '/quit';
      }
      throw error;
    }
  }

  /**
   * Prompt for multi-line text input (ends with empty line)
   * @param {string} [prompt='Enter text (empty line to finish):']
   * @returns {Promise<string>}
   */
  async promptMultiline(prompt = 'Enter text (empty line to finish):') {
    console.log(prompt);
    
    const lines = [];
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    return new Promise((resolve) => {
      rl.on('line', (line) => {
        if (line === '') {
          rl.close();
          const text = lines.join('\n');
          this.#logger.debug('input.multiline', { lineCount: lines.length });
          resolve(text);
        } else {
          lines.push(line);
        }
      });
    });
  }

  // ==================== Choice Selection ====================

  /**
   * Prompt user to select from choices (arrow key navigation)
   * @param {Array} choices - Array of { name, value } or 2D array of buttons
   * @param {string} [message='Select an option:']
   * @returns {Promise<string>} - Selected value/callback_data
   */
  async promptChoice(choices, message = 'Select an option:') {
    // Normalize choices - handle both flat and 2D button arrays
    const normalizedChoices = this.#normalizeChoices(choices);
    
    if (normalizedChoices.length === 0) {
      this.#logger.warn('input.choice.empty', { message });
      return null;
    }

    try {
      const answer = await select({
        message,
        choices: normalizedChoices,
        theme: {
          prefix: '   ',
          style: {
            highlight: (text) => `❯ ${text}`,
          },
        },
      });

      this.#logger.debug('input.choice', { selected: answer });
      return answer;
    } catch (error) {
      if (error.name === 'ExitPromptError') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Prompt for confirmation (yes/no)
   * @param {string} message
   * @param {boolean} [defaultValue=true]
   * @returns {Promise<boolean>}
   */
  async promptConfirm(message, defaultValue = true) {
    try {
      const answer = await confirm({
        message,
        default: defaultValue,
        theme: {
          prefix: '   ',
        },
      });

      this.#logger.debug('input.confirm', { message, answer });
      return answer;
    } catch (error) {
      if (error.name === 'ExitPromptError') {
        return false;
      }
      throw error;
    }
  }

  // ==================== Input Detection ====================

  /**
   * Detect the type of input and parse it
   * @param {string} text - Raw input text
   * @returns {{ type: string, data: any }}
   */
  detectInputType(text) {
    if (!text || text.trim() === '') {
      return { type: InputType.TEXT, data: { text: '' } };
    }

    const trimmed = text.trim();

    // Check for single character button press (1-9, 0, A-Z)
    if (trimmed.length === 1 && /^[0-9A-Za-z]$/.test(trimmed)) {
      this.#logger.debug('input.buttonPress', { buttonId: trimmed.toUpperCase() });
      return {
        type: InputType.BUTTON_PRESS,
        data: { buttonId: trimmed.toUpperCase() },
      };
    }

    // Check for command
    const commandMatch = trimmed.match(SPECIAL_PATTERNS.COMMAND);
    if (commandMatch) {
      const [, command, args] = commandMatch;
      const normalizedCommand = command.toLowerCase();
      
      if (COMMANDS[normalizedCommand]) {
        this.#logger.debug('input.command', { command: normalizedCommand, args });
        return {
          type: InputType.COMMAND,
          data: { command: normalizedCommand, args: args?.trim() || null },
        };
      }
    }

    // Check for photo simulation
    const photoMatch = trimmed.match(SPECIAL_PATTERNS.PHOTO);
    if (photoMatch) {
      const [, path] = photoMatch;
      this.#logger.debug('input.photo', { path });
      return {
        type: InputType.PHOTO,
        data: { path: path.trim() },
      };
    }

    // Check for voice simulation
    const voiceMatch = trimmed.match(SPECIAL_PATTERNS.VOICE);
    if (voiceMatch) {
      const [, transcript] = voiceMatch;
      this.#logger.debug('input.voice', { transcript });
      return {
        type: InputType.VOICE,
        data: { transcript: transcript.trim() },
      };
    }

    // Check for UPC barcode simulation
    const upcMatch = trimmed.match(SPECIAL_PATTERNS.UPC);
    if (upcMatch) {
      const [, upc] = upcMatch;
      this.#logger.debug('input.upc', { upc });
      return {
        type: InputType.UPC,
        data: { upc },
      };
    }

    // Check for image URL (http/https with image extension)
    if (SPECIAL_PATTERNS.IMAGE_URL.test(trimmed)) {
      this.#logger.debug('input.imageUrl', { url: trimmed });
      return {
        type: InputType.PHOTO,
        data: { url: trimmed, sourceType: 'url' },
      };
    }

    // Check for local image path
    if (SPECIAL_PATTERNS.IMAGE_PATH.test(trimmed)) {
      this.#logger.debug('input.imagePath', { path: trimmed });
      return {
        type: InputType.PHOTO,
        data: { path: trimmed, sourceType: 'path' },
      };
    }

    // Check for base64 image data URL
    if (SPECIAL_PATTERNS.BASE64_IMAGE.test(trimmed)) {
      this.#logger.debug('input.base64Image', { length: trimmed.length });
      return {
        type: InputType.PHOTO,
        data: { base64: trimmed, sourceType: 'base64' },
      };
    }

    // Default to text
    return {
      type: InputType.TEXT,
      data: { text: trimmed },
    };
  }

  /**
   * Check if input is a known command
   * @param {string} text
   * @returns {boolean}
   */
  isCommand(text) {
    const { type } = this.detectInputType(text);
    return type === InputType.COMMAND;
  }

  /**
   * Get list of available commands
   * @returns {Object}
   */
  getAvailableCommands() {
    return { ...COMMANDS };
  }

  // ==================== Bot Selection ====================

  /**
   * Prompt to select a chatbot
   * @returns {Promise<string|null>} - Bot name or null if exit
   */
  async promptBotSelection() {
    const choices = [
      { name: '🍎 NutriBot - Food logging & nutrition tracking', value: 'nutribot' },
      { name: '📓 Journalist - Daily journaling & reflection', value: 'journalist' },
      { name: '⚙️  Settings', value: 'settings' },
      { name: '🚪 Exit', value: 'exit' },
    ];

    try {
      const answer = await select({
        message: 'Select a chatbot:',
        choices,
        theme: {
          prefix: '  ',
        },
      });

      this.#logger.info('input.botSelected', { bot: answer });
      return answer;
    } catch (error) {
      if (error.name === 'ExitPromptError') {
        return 'exit';
      }
      throw error;
    }
  }

  /**
   * Prompt for settings options
   * @returns {Promise<string>}
   */
  async promptSettings() {
    const choices = [
      { name: '🔊 Toggle debug logging', value: 'debug' },
      { name: '🗑️  Clear all sessions', value: 'clear_sessions' },
      { name: '🔙 Back to main menu', value: 'back' },
    ];

    try {
      const answer = await select({
        message: 'Settings:',
        choices,
        theme: {
          prefix: '  ',
        },
      });

      return answer;
    } catch (error) {
      if (error.name === 'ExitPromptError') {
        return 'back';
      }
      throw error;
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Normalize choices from various formats
   * @private
   * @param {Array} choices - Flat array or 2D button array
   * @returns {Array} - Normalized choices for inquirer
   */
  #normalizeChoices(choices) {
    if (!choices || choices.length === 0) return [];

    // Check if it's a 2D array (button rows)
    if (Array.isArray(choices[0]) && choices[0][0]?.text) {
      // Flatten 2D button array
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

    // Check if already in { name, value } format
    if (choices[0]?.name && choices[0]?.value !== undefined) {
      return choices;
    }

    // Simple string array
    if (typeof choices[0] === 'string') {
      return choices.map(c => ({ name: c, value: c }));
    }

    return choices;
  }
}

export default CLIInputHandler;
