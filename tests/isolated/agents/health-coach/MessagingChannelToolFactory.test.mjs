import { describe, it, expect, vi } from 'vitest';

import { MessagingChannelToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs';

describe('MessagingChannelToolFactory', () => {
  it('creates 1 tool named send_channel_message', () => {
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: vi.fn() },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('send_channel_message');
  });

  it('send_channel_message calls gateway with correct args', async () => {
    const sendMock = vi.fn(async () => ({ messageId: '999' }));
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    const result = await tool.execute({ text: 'Hello', parseMode: 'HTML' });
    expect(result.success).toBe(true);
    expect(result.messageId).toBe('999');
    expect(sendMock.mock.calls.length).toBe(1);
    expect(sendMock.mock.calls[0][0]).toBe('test:123');
    expect(sendMock.mock.calls[0][1]).toBe('Hello');
  });

  it('defaults parseMode to HTML', async () => {
    const sendMock = vi.fn(async () => ({ messageId: '1' }));
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    await tool.execute({ text: 'Hi' });
    const opts = sendMock.mock.calls[0][2];
    expect(opts.parseMode).toBe('HTML');
  });

  it('handles gateway errors', async () => {
    const sendMock = vi.fn(async () => { throw new Error('network fail'); });
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    const result = await tool.execute({ text: 'Hi' });
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
