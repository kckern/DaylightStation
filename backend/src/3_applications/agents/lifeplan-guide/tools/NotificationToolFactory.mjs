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
            username: { type: 'string' },
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
          required: ['username', 'title', 'body'],
        },
        execute: async ({ username, title, body, actions = [] }) => {
          const results = notificationService.send({
            title,
            body,
            category: 'lifeplan',
            urgency: 'normal',
            metadata: { username, actions, source: 'lifeplan-guide' },
          });
          return { delivered: results?.some(r => r.delivered) || false };
        },
      }),
    ];
  }
}
