import { it, expect, vi } from 'vitest';
import { JournalistInputRouter } from './JournalistInputRouter.mjs';
const event = (text = 'I finished Sample task', type = 'text', callbackData) => ({
  type,
  platform: 'telegram',
  platformUserId: '101',
  conversationId: 'telegram:private',
  messageId: '99',
  metadata: {
    senderId: '101',
    chatId: '101',
    chatType: 'private'
  },
  payload: {
    text,
    callbackData
  }
});
it('passes independent Work principal to journal persistence while KB and AI are absent', async () => {
  const execute = vi.fn(async () => ({
      success: true
    })),
    principal = Object.freeze({
      username: 'sample'
    });
  const router = new JournalistInputRouter({
    getProcessTextEntry: () => ({
      execute
    })
  }, {
    aiGatewayAvailable: false,
    workCompanion: {},
    logger: {
      debug() {},
      warn() {},
      error() {}
    }
  });
  await router.route(event(), {}, {
    workPrincipal: principal
  });
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({
    workPrincipal: principal,
    aiAvailable: false
  }));
});
it('consumes Work callback namespace ahead of generic handlers without logging tokens', async () => {
  const legacy = vi.fn(),
    work = vi.fn(async () => ({
      handled: true,
      status: 'denied'
    })),
    logs = [];
  const router = new JournalistInputRouter({
    getHandleCallbackResponse: () => ({
      execute: legacy
    })
  }, {
    workCompanion: {
      handleCallback: work
    },
    logger: {
      debug: (...args) => logs.push(args),
      warn() {},
      error() {}
    }
  });
  const principal = Object.freeze({
      username: 'sample'
    }),
    token = 'w1:opaque-token';
  expect(await router.route(event('', 'callback', token), {}, {
    workPrincipal: principal
  })).toMatchObject({
    handled: true,
    status: 'denied'
  });
  expect(work.mock.calls[0][0]).toMatchObject({
    principal,
    callbackData: token
  });
  expect(legacy).not.toHaveBeenCalled();
  expect(JSON.stringify(logs)).not.toContain(token);
});
it('plain keyboard action labels open a selection flow and cannot dispatch a command', async () => {
  const open = vi.fn(async () => ({
      handled: true,
      status: 'sent'
    })),
    journal = vi.fn();
  const router = new JournalistInputRouter({
    getProcessTextEntry: () => ({
      execute: journal
    })
  }, {
    workCompanion: {
      open
    },
    logger: {
      debug() {},
      warn() {},
      error() {}
    }
  });
  const principal = Object.freeze({
    username: 'sample'
  });
  await router.route(event('Complete task'), {}, {
    workPrincipal: principal
  });
  expect(open).toHaveBeenCalledWith(expect.objectContaining({
    principal,
    flow: 'tasks'
  }));
  expect(journal).not.toHaveBeenCalled();
});
