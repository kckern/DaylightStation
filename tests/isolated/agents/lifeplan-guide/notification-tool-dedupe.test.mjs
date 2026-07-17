import { describe, it, expect, beforeEach } from 'vitest';
import { NotificationToolFactory } from '#apps/agents/lifeplan-guide/tools/NotificationToolFactory.mjs';

// Task 7 follow-up: CadenceCheck (the only production caller of
// send_action_message) passes a hardcoded title of 'Life Coach' for every
// coach nudge. If dedupeKey were derived from title alone, every distinct
// message to the same user within the cooldown window would collapse to
// the same key and the notification governance layer would wrongly
// suppress the second, different message. dedupeKey must vary with the
// message body (the actual LLM-composed content).
describe('NotificationToolFactory dedupeKey', () => {
  let factory, tools, sentIntents;

  beforeEach(() => {
    sentIntents = [];
    factory = new NotificationToolFactory({
      notificationService: {
        send: (intent) => {
          sentIntents.push(intent);
          return [{ delivered: true }];
        },
      },
    });
    tools = factory.createTools();
  });

  it('produces different dedupeKeys for same title, different bodies', async () => {
    const tool = tools.find((t) => t.name === 'send_action_message');

    await tool.execute({
      userId: 'kckern',
      title: 'Life Coach',
      body: 'Your cycle retro is due today.',
      actions: [],
    });

    await tool.execute({
      userId: 'kckern',
      title: 'Life Coach',
      body: 'Time to check in on your weekly goals.',
      actions: [],
    });

    expect(sentIntents).toHaveLength(2);
    const [first, second] = sentIntents;
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
    expect(first.dedupeKey).toBe('action:kckern:Your cycle retro is due today.');
    expect(second.dedupeKey).toBe('action:kckern:Time to check in on your weekly goals.');
  });

  it('produces the same dedupeKey for identical title and body', async () => {
    const tool = tools.find((t) => t.name === 'send_action_message');

    await tool.execute({
      userId: 'kckern',
      title: 'Life Coach',
      body: 'Your cycle retro is due today.',
      actions: [],
    });

    await tool.execute({
      userId: 'kckern',
      title: 'Life Coach',
      body: 'Your cycle retro is due today.',
      actions: [],
    });

    expect(sentIntents).toHaveLength(2);
    expect(sentIntents[0].dedupeKey).toBe(sentIntents[1].dedupeKey);
  });
});
