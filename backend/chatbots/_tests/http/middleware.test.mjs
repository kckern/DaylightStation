/**
 * HTTP Middleware Tests
 * @group http
 * @group Phase5
 */

import { jest } from '@jest/globals';
import { tracingMiddleware } from '../../adapters/http/middleware/tracing.mjs';
import { webhookValidationMiddleware } from '../../adapters/http/middleware/validation.mjs';
import { 
  idempotencyMiddleware, 
  clearIdempotencyStore,
  getIdempotencyStoreSize,
} from '../../adapters/http/middleware/idempotency.mjs';
import { errorHandlerMiddleware } from '../../adapters/http/middleware/errorHandler.mjs';
import { DomainError, ValidationError, NotFoundError } from '../../_lib/errors/index.mjs';

// Mock request/response
const createMockReq = (overrides = {}) => ({
  headers: {},
  body: null,
  query: {},
  path: '/test',
  baseUrl: '/api',
  traceId: null,
  ...overrides,
});

const createMockRes = () => {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
  };
  res.status = jest.fn().mockImplementation(code => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation(body => {
    res.body = body;
    return res;
  });
  res.setHeader = jest.fn().mockImplementation((name, value) => {
    res.headers[name] = value;
    return res;
  });
  return res;
};

const createMockNext = () => jest.fn();

describe('HTTP Middleware', () => {
  describe('tracingMiddleware', () => {
    it('should generate trace ID if not provided', () => {
      const middleware = tracingMiddleware();
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(req.traceId).toBeDefined();
      expect(req.traceId).toMatch(/^[a-f0-9-]{36}$/);
      expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', req.traceId);
      expect(next).toHaveBeenCalled();
    });

    it('should use trace ID from header', () => {
      const middleware = tracingMiddleware();
      const req = createMockReq({
        headers: { 'x-trace-id': 'test-trace-123' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(req.traceId).toBe('test-trace-123');
      expect(res.setHeader).toHaveBeenCalledWith('X-Trace-Id', 'test-trace-123');
    });
  });

  describe('webhookValidationMiddleware', () => {
    it('should pass valid message payload', () => {
      const middleware = webhookValidationMiddleware('testbot');
      const req = createMockReq({
        body: {
          message: {
            chat: { id: 123 },
            message_id: 456,
            text: 'Hello',
          },
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(req.chatId).toBe('123');
      expect(req.messageId).toBe('456');
      expect(req.webhookType).toBe('message');
      expect(next).toHaveBeenCalled();
    });

    it('should pass valid callback_query payload', () => {
      const middleware = webhookValidationMiddleware('testbot');
      const req = createMockReq({
        body: {
          callback_query: {
            message: {
              chat: { id: 789 },
              message_id: 101,
            },
            data: 'button_clicked',
          },
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(req.chatId).toBe('789');
      expect(req.webhookType).toBe('callback_query');
      expect(next).toHaveBeenCalled();
    });

    it('should reject missing body with 200', () => {
      const middleware = webhookValidationMiddleware('testbot');
      const req = createMockReq({ body: null });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body.skipped).toBe(true);
      expect(res.body.reason).toBe('no_body');
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid structure with 200', () => {
      const middleware = webhookValidationMiddleware('testbot');
      const req = createMockReq({
        body: { random: 'data' },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body.reason).toBe('invalid_structure');
    });
  });

  describe('idempotencyMiddleware', () => {
    beforeEach(() => {
      clearIdempotencyStore();
    });

    it('should allow first request through', () => {
      const middleware = idempotencyMiddleware({ ttlMs: 1000 });
      const req = createMockReq({
        body: {
          update_id: 12345,
          message: { message_id: 100 },
        },
      });
      const res = createMockRes();
      const next = createMockNext();

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(getIdempotencyStoreSize()).toBe(1);
    });

    it('should block duplicate request', () => {
      const middleware = idempotencyMiddleware({ ttlMs: 1000 });
      const req1 = createMockReq({
        body: {
          update_id: 12345,
          message: { message_id: 100 },
        },
      });
      const req2 = createMockReq({
        body: {
          update_id: 12345,
          message: { message_id: 100 },
        },
      });
      const res1 = createMockRes();
      const res2 = createMockRes();
      const next1 = createMockNext();
      const next2 = createMockNext();

      middleware(req1, res1, next1);
      middleware(req2, res2, next2);

      expect(next1).toHaveBeenCalled();
      expect(next2).not.toHaveBeenCalled();
      expect(res2.status).toHaveBeenCalledWith(200);
      expect(res2.body.skipped).toBe(true);
      expect(res2.body.reason).toBe('duplicate');
    });

    it('should allow different requests', () => {
      const middleware = idempotencyMiddleware({ ttlMs: 1000 });
      const req1 = createMockReq({
        body: {
          update_id: 11111,
          message: { message_id: 100 },
        },
      });
      const req2 = createMockReq({
        body: {
          update_id: 22222,
          message: { message_id: 200 },
        },
      });
      const res1 = createMockRes();
      const res2 = createMockRes();
      const next1 = createMockNext();
      const next2 = createMockNext();

      middleware(req1, res1, next1);
      middleware(req2, res2, next2);

      expect(next1).toHaveBeenCalled();
      expect(next2).toHaveBeenCalled();
      expect(getIdempotencyStoreSize()).toBe(2);
    });
  });

  describe('errorHandlerMiddleware', () => {
    it('should handle domain errors with 422', () => {
      const middleware = errorHandlerMiddleware({ isWebhook: false });
      const error = new DomainError('Domain error');
      const req = createMockReq({ traceId: 'trace-123' });
      const res = createMockRes();
      const next = createMockNext();

      middleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(422);
      expect(res.body.ok).toBe(false);
      expect(res.body.error.type).toBe('DomainError');
    });

    it('should handle validation errors with 400', () => {
      const middleware = errorHandlerMiddleware({ isWebhook: false });
      const error = new ValidationError('Invalid input');
      const req = createMockReq({ traceId: 'trace-123' });
      const res = createMockRes();
      const next = createMockNext();

      middleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it('should handle not found errors with 404', () => {
      const middleware = errorHandlerMiddleware({ isWebhook: false });
      const error = new NotFoundError('Not found');
      const req = createMockReq({ traceId: 'trace-123' });
      const res = createMockRes();
      const next = createMockNext();

      middleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
    });

    it('should always return 200 for webhooks', () => {
      const middleware = errorHandlerMiddleware({ isWebhook: true });
      const error = new Error('Some error');
      const req = createMockReq({ traceId: 'trace-123' });
      const res = createMockRes();
      const next = createMockNext();

      middleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.body.ok).toBe(true); // Still reports ok for Telegram
    });

    it('should handle unknown errors with 500', () => {
      const middleware = errorHandlerMiddleware({ isWebhook: false });
      const error = new Error('Unknown error');
      const req = createMockReq({ traceId: 'trace-123' });
      const res = createMockRes();
      const next = createMockNext();

      middleware(error, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
