import { describe, it, mock } from 'node:test';
import { strict as assert } from 'node:assert';
import { MessagingChannelToolFactory } from '../../../../backend/src/3_applications/agents/health-coach/tools/MessagingChannelToolFactory.mjs';

describe('MessagingChannelToolFactory', () => {
  it('creates 1 tool named send_channel_message', () => {
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: mock.fn() },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'send_channel_message');
  });

  it('send_channel_message calls gateway with correct args', async () => {
    const sendMock = mock.fn(async () => ({ messageId: '999' }));
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    const result = await tool.execute({ text: 'Hello', parseMode: 'HTML' });
    assert.equal(result.success, true);
    assert.equal(result.messageId, '999');
    assert.equal(sendMock.mock.calls.length, 1);
    assert.equal(sendMock.mock.calls[0].arguments[0], 'test:123');
    assert.equal(sendMock.mock.calls[0].arguments[1], 'Hello');
  });

  it('defaults parseMode to HTML', async () => {
    const sendMock = mock.fn(async () => ({ messageId: '1' }));
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    await tool.execute({ text: 'Hi' });
    const opts = sendMock.mock.calls[0].arguments[2];
    assert.equal(opts.parseMode, 'HTML');
  });

  it('handles gateway errors', async () => {
    const sendMock = mock.fn(async () => { throw new Error('network fail'); });
    const factory = new MessagingChannelToolFactory({
      messagingGateway: { sendMessage: sendMock },
      conversationId: 'test:123',
    });
    const tools = factory.createTools();
    const tool = tools.find(t => t.name === 'send_channel_message');
    const result = await tool.execute({ text: 'Hi' });
    assert.equal(result.success, false);
    assert.ok(result.error);
  });
});
