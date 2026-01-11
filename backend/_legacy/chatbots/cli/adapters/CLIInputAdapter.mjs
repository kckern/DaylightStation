/**
 * CLI Input Adapter
 * @module cli/adapters/CLIInputAdapter
 * 
 * Converts CLI input types to platform-agnostic InputEvents
 * for use with the UnifiedEventRouter.
 */

import { createInputEvent, InputEventType } from '../../application/ports/IInputEvent.mjs';

// CLI channel identifier
const CLI_CHANNEL = 'cli';

/**
 * CLI Input Adapter
 * Adapts CLI-specific input to InputEvents
 */
export class CLIInputAdapter {
  /**
   * Convert CLI InputType to InputEvent
   * @param {import('../input/CLIInputHandler.mjs').InputType} type - CLI input type
   * @param {Object} data - CLI input data
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @param {string} [messageId] - Optional message ID
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent|null}
   */
  static fromCLIInput(type, data, userId, conversationId, messageId = null) {
    // Map CLI InputType to InputEventType
    switch (type) {
      case 'TEXT':
      case 'text':
        if (!data?.text) return null;
        return createInputEvent({
          type: InputEventType.TEXT,
          channel: CLI_CHANNEL,
          userId,
          conversationId,
          messageId,
          payload: { text: data.text },
        });

      case 'PHOTO':
      case 'photo':
        if (!data) return null;
        return createInputEvent({
          type: InputEventType.IMAGE,
          channel: CLI_CHANNEL,
          userId,
          conversationId,
          messageId,
          payload: {
            fileId: data.fileId || null,
            url: data.url || data.localPath || null,
            localPath: data.localPath || null,
          },
        });

      case 'VOICE':
      case 'voice':
        if (!data) return null;
        return createInputEvent({
          type: InputEventType.VOICE,
          channel: CLI_CHANNEL,
          userId,
          conversationId,
          messageId,
          payload: {
            fileId: data.fileId || null,
            localPath: data.localPath || null,
            duration: data.duration || null,
          },
        });

      case 'UPC':
      case 'upc':
        if (!data?.upc) return null;
        return createInputEvent({
          type: InputEventType.UPC,
          channel: CLI_CHANNEL,
          userId,
          conversationId,
          messageId,
          payload: { upc: data.upc },
        });

      case 'COMMAND':
      case 'command':
        if (!data?.command) return null;
        return createInputEvent({
          type: InputEventType.COMMAND,
          channel: CLI_CHANNEL,
          userId,
          conversationId,
          messageId,
          payload: { 
            command: data.command,
            args: data.args || null,
          },
        });

      case 'BUTTON_PRESS':
      case 'button_press':
        // Button presses need to be resolved to callback data first
        // This is handled separately by the CLI simulator
        return null;

      default:
        return null;
    }
  }

  /**
   * Create a callback event from button press
   * @param {string} callbackData - Button callback data
   * @param {string} sourceMessageId - Message the button was on
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent}
   */
  static fromButtonPress(callbackData, sourceMessageId, userId, conversationId) {
    return createInputEvent({
      type: InputEventType.CALLBACK,
      channel: CLI_CHANNEL,
      userId,
      conversationId,
      messageId: null, // Button press doesn't have its own message ID
      payload: {
        data: callbackData,
        sourceMessageId,
      },
    });
  }

  /**
   * Create a text event for revision input
   * @param {string} text - Revision text
   * @param {string} userId - User ID
   * @param {string} conversationId - Conversation ID
   * @returns {import('../../application/ports/IInputEvent.mjs').IInputEvent}
   */
  static fromRevisionInput(text, userId, conversationId) {
    return createInputEvent({
      type: InputEventType.TEXT,
      channel: CLI_CHANNEL,
      userId,
      conversationId,
      messageId: null,
      payload: { text },
    });
  }

  /**
   * Build a conversation ID for CLI
   * @param {string} sessionId - CLI session ID
   * @param {string} botName - Bot name (nutribot, journalist)
   * @returns {string}
   */
  static buildConversationId(sessionId, botName) {
    return `${CLI_CHANNEL}:${botName}_${sessionId}`;
  }

  /**
   * Parse a CLI conversation ID
   * @param {string} conversationId
   * @returns {{ sessionId: string, botName: string }|null}
   */
  static parseConversationId(conversationId) {
    const match = conversationId.match(/^cli:(\w+)_(.+)$/);
    if (!match) return null;
    return {
      botName: match[1],
      sessionId: match[2],
    };
  }
}

export default CLIInputAdapter;
