// backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs

import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class MessagingChannelToolFactory extends ToolFactory {
  static domain = 'messaging';

  createTools() {
    const { messagingGateway, conversationId } = this.deps;

    return [
      createTool({
        name: 'send_channel_message',
        description: "Send a message to the user's messaging channel",
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Message content' },
            parseMode: {
              type: 'string',
              enum: ['HTML', 'Markdown'],
              default: 'HTML',
              description: 'Markup format',
            },
          },
          required: ['text'],
        },
        execute: async ({ text, parseMode = 'HTML' }) => {
          try {
            const result = await messagingGateway.sendMessage(conversationId, text, { parseMode });
            return { success: true, messageId: result.messageId };
          } catch (err) {
            return { success: false, error: err.message };
          }
        },
      }),
    ];
  }
}
