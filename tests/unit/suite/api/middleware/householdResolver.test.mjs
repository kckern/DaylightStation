// tests/unit/suite/api/middleware/householdResolver.test.mjs
import { jest } from '@jest/globals';
import { householdResolver, matchPatterns } from '#backend/src/4_api/middleware/householdResolver.mjs';

describe('householdResolver middleware', () => {
  let mockConfigService;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockConfigService = {
      householdExists: jest.fn().mockReturnValue(true),
      getHousehold: jest.fn().mockReturnValue({ name: 'Test Household' }),
    };
    mockReq = { headers: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
  });

  describe('explicit domain mapping', () => {
    test('resolves household from explicit mapping', () => {
      const domainConfig = {
        domain_mapping: {
          'daylight.example.com': 'default',
          'daylight-jones.example.com': 'jones',
          'localhost:3112': 'default',
        },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'daylight-jones.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('jones');
      expect(mockNext).toHaveBeenCalled();
    });

    test('resolves localhost with port', () => {
      const domainConfig = {
        domain_mapping: { 'localhost:3112': 'default' },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'localhost:3112';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('default');
    });
  });

  describe('pattern matching', () => {
    test('matches daylight-{household}.example.com pattern', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [
          { regex: '^daylight-(?<household>\\w+)\\.' },
        ],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'daylight-smith.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('smith');
    });

    test('matches {household}.daylight.example.com pattern', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [
          { regex: '^(?<household>\\w+)\\.daylight\\.' },
        ],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'jones.daylight.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('jones');
    });
  });

  describe('fallback behavior', () => {
    test('falls back to default when no match', () => {
      const domainConfig = {
        domain_mapping: {},
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'unknown.domain.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockReq.householdId).toBe('default');
    });
  });

  describe('household validation', () => {
    test('returns 404 for non-existent household', () => {
      mockConfigService.householdExists.mockReturnValue(false);

      const domainConfig = {
        domain_mapping: { 'fake.example.com': 'nonexistent' },
        patterns: [],
      };

      const middleware = householdResolver({ domainConfig, configService: mockConfigService });
      mockReq.headers.host = 'fake.example.com';

      middleware(mockReq, mockRes, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Household not found',
        household: 'nonexistent',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });
  });
});

describe('matchPatterns', () => {
  test('returns first matching household from patterns', () => {
    const patterns = [
      { regex: '^daylight-(?<household>\\w+)\\.' },
      { regex: '^(?<household>\\w+)\\.daylight\\.' },
    ];

    expect(matchPatterns('daylight-jones.example.com', patterns)).toBe('jones');
    expect(matchPatterns('smith.daylight.example.com', patterns)).toBe('smith');
    expect(matchPatterns('unknown.com', patterns)).toBeNull();
  });
});
