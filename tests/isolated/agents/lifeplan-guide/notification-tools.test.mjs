import { describe, it, expect, beforeEach } from '@jest/globals';
import { NotificationToolFactory } from '#apps/agents/lifeplan-guide/tools/NotificationToolFactory.mjs';

describe('NotificationToolFactory', () => {
  let factory, tools, sentMessages;

  beforeEach(() => {
    sentMessages = [];
    factory = new NotificationToolFactory({
      notificationService: {
        send: (intent) => { sentMessages.push(intent); return [{ delivered: true }]; },
      },
    });
    tools = factory.createTools();
  });

  it('creates 1 tool', () => {
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('send_action_message');
  });

  it('sends notification with actions', async () => {
    const tool = tools[0];
    const result = await tool.execute({
      username: 'test',
      title: 'Weekly retro is due',
      body: 'Time for your cycle retrospective.',
      actions: [
        { label: 'Start retro', action: 'start_ceremony', data: { type: 'cycle_retro' } },
        { label: 'Snooze', action: 'snooze', data: { hours: 24 } },
      ],
    });
    expect(result.delivered).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].title).toBe('Weekly retro is due');
    expect(sentMessages[0].metadata.actions).toHaveLength(2);
  });
});
