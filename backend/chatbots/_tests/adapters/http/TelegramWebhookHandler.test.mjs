/**
 * TelegramWebhookHandler Tests
 * @module _tests/adapters/http/TelegramWebhookHandler.test
 */

import {
  createTelegramWebhookHandler,
  createWebhookValidationMiddleware,
  createIdempotencyMiddleware,
  asyncHandler,
} from '../../../adapters/http/TelegramWebhookHandler.mjs';

// Simple mock function creator for ESM compatibility
function createMockFn(impl) {
  const calls = [];
  const fn = function(...args) {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  fn.mockClear = () => { calls.length = 0; };
  fn.toHaveBeenCalled = () => calls.length > 0;
  fn.toHaveBeenCalledWith = (...expected) => {
    return calls.some(args => 
      args.length === expected.length && 
      args.every((arg, i) => arg === expected[i])
    );
  };
  return fn;
}

// Mock Express request/response
function createMockRequest(body = {}, headers = {}) {
  return {
    body,
    headers,
    traceId: 'test-trace-123',
  };
}

function createMockResponse() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
  };
  return res;
}

// Mock container
function createMockContainer() {
  return {
    getLogFoodFromText: () => ({
      execute: async () => ({ success: true }),
    }),
    getLogFoodFromImage: () => ({
      execute: async () => ({ success: true }),
    }),
    getLogFoodFromVoice: () => ({
      execute: async () => ({ success: true }),
    }),
    getLogFoodFromUPC: () => ({
      execute: async () => ({ success: true }),
    }),
    getAcceptFoodLog: () => ({
      execute: async () => ({ success: true }),
    }),
    getDiscardFoodLog: () => ({
      execute: async () => ({ success: true }),
    }),
    getReviseFoodLog: () => ({
      execute: async () => ({ success: true }),
    }),
    getProcessRevisionInput: () => ({
      execute: async () => ({ success: true }),
    }),
    getGenerateDailyReport: () => ({
      execute: async () => ({ success: true }),
    }),
    getGenerateThresholdCoaching: () => ({
      execute: async () => ({ success: true }),
    }),
    getAdjustPortionSize: () => ({
      execute: async () => ({ success: true }),
    }),
    getConversationStateStore: () => null,
  };
}

describe('createTelegramWebhookHandler', () => {
  const config = { botId: '6898194425', botName: 'nutribot' };

  it('should throw if container is missing', () => {
    expect(() => createTelegramWebhookHandler(null, config))
      .toThrow('container is required');
  });

  it('should throw if botId is missing', () => {
    expect(() => createTelegramWebhookHandler(createMockContainer(), {}))
      .toThrow('config.botId is required');
  });

  it('should return a function', () => {
    const handler = createTelegramWebhookHandler(createMockContainer(), config);
    expect(typeof handler).toBe('function');
  });

  describe('handling text messages', () => {
    it('should handle text message successfully', async () => {
      const handler = createTelegramWebhookHandler(createMockContainer(), config);
      const req = createMockRequest({
        update_id: 123456,
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: '2 eggs for breakfast',
        },
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  describe('handling callback queries', () => {
    it('should handle callback query', async () => {
      let answerCalled = false;
      let calledWith = null;
      const mockGateway = {
        answerCallbackQuery: async (id) => {
          answerCalled = true;
          calledWith = id;
        },
      };
      const handler = createTelegramWebhookHandler(
        createMockContainer(),
        config,
        { gateway: mockGateway }
      );
      const req = createMockRequest({
        update_id: 123457,
        callback_query: {
          id: 'callback-123',
          message: {
            message_id: 100,
            chat: { id: 575596036 },
          },
          data: 'accept_abc123',
        },
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(answerCalled).toBe(true);
      expect(calledWith).toBe('callback-123');
    });
  });

  describe('handling unsupported updates', () => {
    it('should skip unsupported update types', async () => {
      const handler = createTelegramWebhookHandler(createMockContainer(), config);
      const req = createMockRequest({
        update_id: 123458,
        channel_post: { text: 'ignored' }, // Not handled
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.skipped).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should return 200 even on error (prevent Telegram retries)', async () => {
      const container = createMockContainer();
      container.getLogFoodFromText = () => ({
        execute: async () => { throw new Error('Test error'); },
      });

      const handler = createTelegramWebhookHandler(container, config);
      const req = createMockRequest({
        update_id: 123459,
        message: {
          message_id: 100,
          chat: { id: 575596036 },
          text: 'test',
        },
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.error).toBe('Test error');
    });
  });
});

describe('createWebhookValidationMiddleware', () => {
  it('should pass valid requests', () => {
    const middleware = createWebhookValidationMiddleware();
    const req = createMockRequest({ update_id: 123 });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(true);
  });

  it('should reject missing body', () => {
    const middleware = createWebhookValidationMiddleware();
    const req = { body: null, headers: {} };
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(nextCalled).toBe(false);
  });

  it('should reject missing update_id', () => {
    const middleware = createWebhookValidationMiddleware();
    const req = createMockRequest({});
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Missing update_id');
  });

  it('should validate secret token when configured', () => {
    const middleware = createWebhookValidationMiddleware({ secretToken: 'my-secret' });
    const req = createMockRequest({ update_id: 123 }, { 'x-telegram-bot-api-secret-token': 'wrong' });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it('should pass with valid secret token', () => {
    const middleware = createWebhookValidationMiddleware({ secretToken: 'my-secret' });
    const req = createMockRequest(
      { update_id: 123 },
      { 'x-telegram-bot-api-secret-token': 'my-secret' }
    );
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(true);
  });
});

describe('createIdempotencyMiddleware', () => {
  it('should allow first request', () => {
    const cache = new Map();
    const middleware = createIdempotencyMiddleware({ cache });
    const req = createMockRequest({ update_id: 100 });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(true);
    expect(cache.has('update:100')).toBe(true);
  });

  it('should reject duplicate requests', () => {
    const cache = new Map();
    const middleware = createIdempotencyMiddleware({ cache });
    const req = createMockRequest({ update_id: 100 });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    // First request
    middleware(req, res, next);
    expect(nextCalled).toBe(true);

    // Second request (duplicate)
    nextCalled = false;
    const res2 = createMockResponse();
    middleware(req, res2, next);

    expect(nextCalled).toBe(false);
    expect(res2.statusCode).toBe(200);
    expect(res2.body.duplicate).toBe(true);
  });

  it('should pass requests without update_id', () => {
    const cache = new Map();
    const middleware = createIdempotencyMiddleware({ cache });
    const req = createMockRequest({});
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    middleware(req, res, next);

    expect(nextCalled).toBe(true);
  });
});

describe('asyncHandler', () => {
  it('should call next on error', async () => {
    const error = new Error('Test error');
    const handler = asyncHandler(async () => { throw error; });
    let nextCalledWith = null;
    const next = (err) => { nextCalledWith = err; };

    await handler({}, {}, next);

    expect(nextCalledWith).toBe(error);
  });

  it('should not call next on success', async () => {
    const handler = asyncHandler(async (req, res) => {
      res.json({ ok: true });
    });
    const res = createMockResponse();
    let nextCalled = false;
    const next = () => { nextCalled = true; };

    await handler({}, res, next);

    expect(nextCalled).toBe(false);
    expect(res.body.ok).toBe(true);
  });
});
