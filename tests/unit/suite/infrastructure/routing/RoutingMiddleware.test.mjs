// tests/unit/infrastructure/routing/RoutingMiddleware.test.mjs
import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import {
  createRoutingMiddleware,
  wrapResponseWithShim,
} from '#backend/src/0_system/routing/RoutingMiddleware.mjs';
import { ShimMetrics } from '#backend/src/0_system/routing/ShimMetrics.mjs';

describe('RoutingMiddleware', () => {
  let legacyApp;
  let newApp;
  let shims;
  let logger;
  let metrics;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    legacyApp = jest.fn((req, res, next) => res.json({ source: 'legacy' }));
    newApp = jest.fn((req, res, next) => res.json({ source: 'new' }));

    shims = {
      'content-v1': {
        transform: jest.fn((data) => ({ ...data, transformed: true })),
      },
    };

    logger = {
      info: jest.fn(),
      error: jest.fn(),
    };

    metrics = new ShimMetrics();

    mockReq = {
      path: '/api/content',
      method: 'GET',
    };

    mockRes = {
      setHeader: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  describe('createRoutingMiddleware', () => {
    it('routes to legacy when config says legacy', () => {
      const config = {
        default: 'new',
        routing: {
          '/api/legacy': 'legacy',
        },
      };

      const middleware = createRoutingMiddleware({
        config,
        legacyApp,
        newApp,
        shims,
        logger,
        metrics,
      });

      mockReq.path = '/api/legacy/data';
      const next = jest.fn();
      middleware(mockReq, mockRes, next);

      expect(legacyApp).toHaveBeenCalledWith(mockReq, mockRes, next);
      expect(newApp).not.toHaveBeenCalled();
    });

    it('routes to new when config says new', () => {
      const config = {
        default: 'legacy',
        routing: {
          '/api/new': 'new',
        },
      };

      const middleware = createRoutingMiddleware({
        config,
        legacyApp,
        newApp,
        shims,
        logger,
        metrics,
      });

      mockReq.path = '/api/new/data';
      const next = jest.fn();
      middleware(mockReq, mockRes, next);

      expect(newApp).toHaveBeenCalledWith(mockReq, mockRes, next);
      expect(legacyApp).not.toHaveBeenCalled();
    });

    it('uses default when path not in config', () => {
      const config = {
        default: 'legacy',
        routing: {
          '/api/specific': 'new',
        },
      };

      const middleware = createRoutingMiddleware({
        config,
        legacyApp,
        newApp,
        shims,
        logger,
        metrics,
      });

      mockReq.path = '/api/unknown/endpoint';
      const next = jest.fn();
      middleware(mockReq, mockRes, next);

      expect(legacyApp).toHaveBeenCalledWith(mockReq, mockRes, next);
      expect(newApp).not.toHaveBeenCalled();
    });

    it('sets x-served-by header', () => {
      const config = {
        default: 'new',
        routing: {},
      };

      const middleware = createRoutingMiddleware({
        config,
        legacyApp,
        newApp,
        shims,
        logger,
        metrics,
      });

      mockReq.path = '/api/something';
      const next = jest.fn();
      middleware(mockReq, mockRes, next);

      expect(mockRes.setHeader).toHaveBeenCalledWith('x-served-by', 'new');
    });

    it('records shim usage when shim applied', () => {
      const config = {
        default: 'legacy',
        routing: {
          '/api/content': { target: 'new', shim: 'content-v1' },
        },
      };

      const middleware = createRoutingMiddleware({
        config,
        legacyApp,
        newApp,
        shims,
        logger,
        metrics,
      });

      mockReq.path = '/api/content';
      const next = jest.fn();
      middleware(mockReq, mockRes, next);

      // Call the wrapped json to trigger shim recording
      mockRes.json({ data: 'test' });

      const report = metrics.getReport();
      expect(report).toHaveLength(1);
      expect(report[0].shim).toBe('content-v1');
    });
  });

  describe('wrapResponseWithShim', () => {
    it('transforms json response using shim', () => {
      const originalJson = jest.fn();
      mockRes.json = originalJson;

      const shim = {
        transform: (data) => ({ ...data, transformed: true }),
      };

      wrapResponseWithShim(mockRes, mockReq, shim, logger, metrics);

      mockRes.json({ original: 'data' });

      expect(originalJson).toHaveBeenCalledWith({
        original: 'data',
        transformed: true,
      });
    });

    it('logs shim application', () => {
      const shim = {
        name: 'content-v1',
        transform: (data) => data,
      };

      wrapResponseWithShim(mockRes, mockReq, shim, logger, metrics);

      mockRes.json({ data: 'test' });

      expect(logger.info).toHaveBeenCalledWith('shim.applied', expect.objectContaining({
        path: mockReq.path,
      }));
    });

    it('returns untransformed data on shim error', () => {
      const originalJson = jest.fn();
      mockRes.json = originalJson;

      const shim = {
        transform: () => {
          throw new Error('Transform failed');
        },
      };

      wrapResponseWithShim(mockRes, mockReq, shim, logger, metrics);

      mockRes.json({ original: 'data' });

      expect(originalJson).toHaveBeenCalledWith({ original: 'data' });
      expect(logger.error).toHaveBeenCalledWith('shim.failed', expect.objectContaining({
        error: 'Transform failed',
      }));
    });
  });
});
