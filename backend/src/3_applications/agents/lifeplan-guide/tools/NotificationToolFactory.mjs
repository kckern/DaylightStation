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
            // NOTE: metadata key is `username`, not `userId` — this is a cross-module
            // wire contract read by TelegramNotificationAdapter and
            // PushNotificationAdapter (intent.metadata?.username) to resolve the
            // delivery recipient. Do not rename this key without updating both
            // adapters and every other producer (e.g. CeremonyScheduler).
            metadata: { username: userId, actions, source: 'lifeplan-guide' },
            // Stable per-logical-message key so governance dedupes on
            // identity rather than a static title (Task 7 follow-up). The
            // only production caller (CadenceCheck) passes a hardcoded
            // title for every coach nudge, so keying on title alone
            // collapsed all distinct messages to one key and silently
            // suppressed genuinely different nudges. Key on the
            // LLM-composed body — the thing that actually varies between
            // messages — falling back to title if body is somehow absent.
            dedupeKey: `action:${userId}:${String(body || title || '').trim().slice(0, 80)}`,
          });
          return { delivered: Array.isArray(results) && results.some(r => r.delivered) };
        },
      }),
    ];
  }
}
