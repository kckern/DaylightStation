import { it, expect, vi } from 'vitest';
import { WorkCompanionAdapter } from './WorkCompanionAdapter.mjs';
function setup(knowledgeCompanion = null) {
  const trusted = new WeakSet();
  const actor = (username, fields = {}) => {
    const p = Object.freeze({
      username,
      ...fields
    });
    trusted.add(p);
    return p;
  };
  const decisions = {
    recordDelivery: vi.fn(async () => {}),
    recordFailure: vi.fn(async () => {})
  };
  const runtime = {
    principal: {
      verify: p => trusted.has(p) ? p : null
    },
    decisions,
    conversation: {
      open: async ({
        principal
      }) => ({
        decisionId: 'decision-' + principal.username,
        text: 'Choose ' + principal.username,
        choices: [[{
          text: 'Complete task',
          callback_data: 'w1:opaque'
        }]]
      }),
      handleCallback: vi.fn(async () => ({
        handled: true,
        status: 'denied',
        reason: 'expired'
      })),
      capturePrincipal: () => null,
      sourceForEntry: () => null,
      onEntrySaved: async () => ({
        handled: true
      })
    }
  };
  const send = vi.fn(async () => ({
    messageId: '200'
  }));
  return {
    runtime,
    actor,
    send,
    adapter: new WorkCompanionAdapter({
      runtime,
      knowledgeCompanion,
      send,
      clock: () => 1000
    }),
    decisions
  };
}
it('sends named inline choices and records the actual message ACK', async () => {
  const x = setup();
  await x.adapter.open({
    principal: x.actor('sample'),
    flow: 'tasks'
  });
  expect(x.send).toHaveBeenCalledWith(expect.objectContaining({
    username: 'sample',
    text: 'Choose sample',
    choices: expect.any(Array),
    parseMode: null
  }));
  expect(x.decisions.recordDelivery).toHaveBeenCalledWith({
    username: 'sample',
    decisionId: 'decision-sample',
    botMessageId: '200',
    asOf: 1000
  });
});
it('quarantines a sent page when ACK persistence fails', async () => {
  const x = setup();
  x.decisions.recordDelivery.mockRejectedValue(new Error('disk unavailable'));
  await expect(x.adapter.open({
    principal: x.actor('sample'),
    flow: 'tasks'
  })).rejects.toThrow();
  expect(x.decisions.recordFailure).toHaveBeenCalledWith(expect.objectContaining({
    username: 'sample',
    decisionId: 'decision-sample',
    uncertain: true
  }));
});
it('keeps response contexts local across concurrent webhook requests', async () => {
  const x = setup();
  let release;
  const held = new Promise(resolve => {
    release = resolve;
  });
  const a = {
      sendMessage: vi.fn(async () => {
        await held;
        return {
          messageId: '201'
        };
      })
    },
    b = {
      sendMessage: vi.fn(async () => ({
        messageId: '202'
      }))
    };
  const first = x.adapter.open({
    principal: x.actor('first'),
    flow: 'tasks',
    responseContext: a
  });
  await x.adapter.open({
    principal: x.actor('second'),
    flow: 'tasks',
    responseContext: b
  });
  release();
  await first;
  expect(a.sendMessage).toHaveBeenCalledWith('Choose first', expect.objectContaining({
    inline: true
  }));
  expect(b.sendMessage).toHaveBeenCalledWith('Choose second', expect.objectContaining({
    inline: true
  }));
  expect(x.decisions.recordDelivery.mock.calls.map(([r]) => [r.username, r.botMessageId])).toEqual([['second', '202'], ['first', '201']]);
  expect(x.send).not.toHaveBeenCalled();
});
it('routes only its opaque namespace and rejects forged principals before sending', async () => {
  const x = setup();
  expect(await x.adapter.handleCallback({
    principal: x.actor('sample'),
    callbackData: 'kb1:other'
  })).toEqual({
    handled: false
  });
  await expect(x.adapter.open({
    principal: {
      username: 'sample'
    },
    flow: 'tasks'
  })).rejects.toThrow();
  expect(x.send).not.toHaveBeenCalled();
  expect(x.runtime.conversation.handleCallback).not.toHaveBeenCalled();
});
it('explains an empty requested flow without creating an acknowledged action page', async () => {
  const x = setup();
  x.runtime.conversation.open = async () => null;
  await x.adapter.open({
    principal: x.actor('sample'),
    flow: 'tasks'
  });
  expect(x.send).toHaveBeenCalledTimes(1);
  expect(x.decisions.recordDelivery).not.toHaveBeenCalled();
});
it('acknowledges a confirmed callback through its local response context', async () => {
  const x = setup();
  x.runtime.conversation.handleCallback.mockResolvedValue({
    handled: true,
    status: 'applied',
    result: {
      outcome: 'applied'
    }
  });
  const responseContext = {
    sendMessage: vi.fn(async () => ({
      messageId: '203'
    }))
  };
  await x.adapter.handleCallback({
    principal: x.actor('sample'),
    callbackData: 'w1:opaque',
    botMessageId: '200',
    responseContext
  });
  expect(responseContext.sendMessage).toHaveBeenCalledTimes(1);
  expect(x.send).not.toHaveBeenCalled();
});
it('sends a plain informational Work page without pretending it contains a decision to ACK', async () => {
  const x = setup();
  x.runtime.conversation.open = async () => ({
    decisionId: null,
    text: 'Send Create task <title>.',
    choices: []
  });
  expect((await x.adapter.open({
    principal: x.actor('sample'),
    flow: 'create_task'
  })).status).toBe('sent');
  expect(x.decisions.recordDelivery).not.toHaveBeenCalled();
});
it('passes the independently supplied KB principal to private review and never substitutes Work identity', async () => {
  const openReview = vi.fn(async () => ({
      status: 'sent'
    })),
    x = setup({
      openReview
    }),
    p = x.actor('sample', {
      conversationId: 'private',
      senderId: '101',
      kind: 'callback',
      messageId: '99',
      receiptId: 'callback:a',
      callbackData: 'w1:opaque'
    }),
    kb = Object.freeze({
      ...p
    });
  x.runtime.conversation.handleCallback.mockResolvedValue({
    handled: true,
    status: 'knowledge_review',
    username: 'sample',
    knowledgeReviewIds: ['one']
  });
  expect((await x.adapter.handleCallback({
    principal: p,
    knowledgePrincipal: kb,
    callbackData: 'w1:opaque',
    botMessageId: '99'
  })).status).toBe('sent');
  expect(openReview).toHaveBeenCalledWith(expect.objectContaining({
    principal: kb,
    ids: ['one']
  }));
  openReview.mockClear();
  expect((await x.adapter.handleCallback({
    principal: p,
    callbackData: 'w1:opaque',
    botMessageId: '99'
  })).status).toBe('deferred');
  expect(openReview).not.toHaveBeenCalled();
});
it('refuses a genuine KB principal from an unrelated interaction before opening private review', async () => {
  const openReview = vi.fn();
  const x = setup({
    openReview
  });
  const p = x.actor('sample', {
    kind: 'callback',
    senderId: '101',
    conversationId: 'private',
    messageId: '99',
    receiptId: 'callback:a',
    callbackData: 'w1:opaque'
  });
  const kb = {
    ...p,
    kind: 'text',
    receiptId: 'message:older',
    callbackData: null
  };
  x.runtime.conversation.handleCallback.mockResolvedValue({
    status: 'knowledge_review',
    knowledgeReviewIds: ['one']
  });
  expect((await x.adapter.handleCallback({
    principal: p,
    knowledgePrincipal: kb,
    callbackData: p.callbackData,
    botMessageId: '99'
  })).status).toBe('deferred');
  expect(openReview).not.toHaveBeenCalled();
});
