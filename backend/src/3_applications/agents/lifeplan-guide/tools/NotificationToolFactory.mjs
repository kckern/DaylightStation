import { ToolFactory } from '../../framework/ToolFactory.mjs';
import { createTool } from '../../ports/ITool.mjs';

export class NotificationToolFactory extends ToolFactory {
  static domain = 'notification';

  createTools() {
    const { notificationService } = this.deps;

    return [
      createTool({
        name: 'send_action_message',
        description: 'Send a notification with inline action buttons to the user.',
        parameters: {
          type: 'object',
          properties: {
            userId: { type: 'string' },
            title: { type: 'string', description: 'Notification title' },
            body: { type: 'string', description: 'Notification body text' },
            actions: {
              type: 'array',
              description: 'Inline action buttons',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string' },
                  action: { type: 'string' },
                  data: { type: 'object' },
                },
                required: ['label', 'action'],
              },
            },
          },
          required: ['userId', 'title', 'body'],
        },
        execute: async ({ userId, title, body, actions = [] }) => {
          // 'ceremony' is the closest valid NotificationCategory for coach
          // nudges ('lifeplan' is not a category and would throw on intent
          // construction).
          const results = await notificationService.send({
            title,
            body,
            category: 'ceremony',
            urgency: 'normal',
            actions,
            metadata: { userId, actions, source: 'lifeplan-guide' },
          });
          return { delivered: Array.isArray(results) && results.some(r => r.delivered) };
        },
      }),
    ];
  }
}
