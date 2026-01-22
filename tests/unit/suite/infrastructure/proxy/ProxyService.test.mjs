// tests/unit/infrastructure/proxy/ProxyService.test.mjs
import { jest } from '@jest/globals';
import { ProxyService } from '#backend/src/0_infrastructure/proxy/ProxyService.mjs';

describe('ProxyService', () => {
  let proxyService;
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    proxyService = new ProxyService({ logger: mockLogger });
  });

  describe('constructor', () => {
    test('creates instance with default logger', () => {
      const service = new ProxyService();
      expect(service).toBeDefined();
    });

    test('creates instance with custom logger', () => {
      expect(proxyService).toBeDefined();
    });
  });

  describe('register', () => {
    test('registers an adapter', () => {
      const mockAdapter = {
        getServiceName: () => 'test-service',
        getBaseUrl: () => 'http://test.local',
        isConfigured: () => true
      };

      proxyService.register(mockAdapter);

      expect(proxyService.getAdapter('test-service')).toBe(mockAdapter);
    });

    test('logs registration', () => {
      const mockAdapter = {
        getServiceName: () => 'plex',
        getBaseUrl: () => 'http://plex.local',
        isConfigured: () => true
      };

      proxyService.register(mockAdapter);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'proxy.adapter.registered',
        { service: 'plex' }
      );
    });
  });

  describe('getAdapter', () => {
    test('returns registered adapter', () => {
      const mockAdapter = {
        getServiceName: () => 'test',
        getBaseUrl: () => 'http://test.local',
        isConfigured: () => true
      };

      proxyService.register(mockAdapter);

      expect(proxyService.getAdapter('test')).toBe(mockAdapter);
    });

    test('returns null for unknown service', () => {
      expect(proxyService.getAdapter('unknown')).toBeNull();
    });
  });

  describe('isConfigured', () => {
    test('returns true for configured adapter', () => {
      const mockAdapter = {
        getServiceName: () => 'test',
        getBaseUrl: () => 'http://test.local',
        isConfigured: () => true
      };

      proxyService.register(mockAdapter);

      expect(proxyService.isConfigured('test')).toBe(true);
    });

    test('returns false for unconfigured adapter', () => {
      const mockAdapter = {
        getServiceName: () => 'test',
        getBaseUrl: () => 'http://test.local',
        isConfigured: () => false
      };

      proxyService.register(mockAdapter);

      expect(proxyService.isConfigured('test')).toBe(false);
    });

    test('returns false for unknown service', () => {
      expect(proxyService.isConfigured('unknown')).toBe(false);
    });
  });

  describe('getServices', () => {
    test('returns empty array when no adapters registered', () => {
      expect(proxyService.getServices()).toEqual([]);
    });

    test('returns all registered service names', () => {
      proxyService.register({
        getServiceName: () => 'plex',
        getBaseUrl: () => 'http://plex.local',
        isConfigured: () => true
      });
      proxyService.register({
        getServiceName: () => 'immich',
        getBaseUrl: () => 'http://immich.local',
        isConfigured: () => true
      });

      const services = proxyService.getServices();

      expect(services).toContain('plex');
      expect(services).toContain('immich');
      expect(services).toHaveLength(2);
    });
  });

  describe('createMiddleware', () => {
    test('returns a function', () => {
      const middleware = proxyService.createMiddleware('test');
      expect(typeof middleware).toBe('function');
    });
  });

  describe('proxy', () => {
    test('returns 404 for unknown service', async () => {
      const mockReq = { url: '/test' };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await proxyService.proxy('unknown', mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Unknown service: unknown' });
    });

    test('returns 503 for unconfigured service', async () => {
      proxyService.register({
        getServiceName: () => 'test',
        getBaseUrl: () => '',
        isConfigured: () => false
      });

      const mockReq = { url: '/test' };
      const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };

      await proxyService.proxy('test', mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(503);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Service not configured: test' });
    });
  });
});
