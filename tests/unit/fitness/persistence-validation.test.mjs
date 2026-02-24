import { describe, it, expect, jest, beforeAll } from '@jest/globals';

// Mock the Logger to prevent side effects
jest.unstable_mockModule('#frontend/lib/logging/Logger.js', () => ({
  default: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  }),
  getLogger: () => ({
    debug: jest.fn(), info: jest.fn(), warn: jest.fn(),
    error: jest.fn(), sampled: jest.fn()
  })
}));

// Mock DaylightAPI (imported by PersistenceManager)
jest.unstable_mockModule('#frontend/lib/api.mjs', () => ({
  DaylightAPI: { post: jest.fn() }
}));

// Mock SessionSerializerV3
jest.unstable_mockModule('#frontend/hooks/fitness/SessionSerializerV3.js', () => ({
  SessionSerializerV3: class { serialize() { return {}; } }
}));

// Mock buildSessionSummary
jest.unstable_mockModule('#frontend/hooks/fitness/buildSessionSummary.js', () => ({
  buildSessionSummary: jest.fn(() => ({}))
}));

let PersistenceManager;
beforeAll(async () => {
  const mod = await import('#frontend/hooks/fitness/PersistenceManager.js');
  PersistenceManager = mod.PersistenceManager;
});

describe('PersistenceManager — validation', () => {
  it('should reject sessions where all HR series are zero', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [0, 0, 0, 0, 0, 0],
          'alice:zone': [null, null, null, null, null, null],
          'alice:coins': [0, 0, 0, 0, 0, 0],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-meaningful-data');
  });

  it('should reject sessions with no HR series at all', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:zone': ['cool', '', '', '', '', ''],
          'alice:coins': [0, 0, 0, 0, 0, 0],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no-meaningful-data');
  });

  it('should drop series where every value is zero or null (mixed)', () => {
    const pm = new PersistenceManager();
    const series = {
      'alice:hr': [80, 85, 90, 88, 92, 95],           // real data — keep
      'bike:7153:rotations': [0, 0, 0, null, null],    // all zero/null — drop
      'bike:28812:rotations': [0, null, 0, null, 0],   // all zero/null — drop
      'bike:49904:rotations': [0, 0, 5, 10, 15, 20],   // has real data — keep
    };
    const { encodedSeries } = pm.encodeSeries(series);

    expect(encodedSeries).toHaveProperty('alice:hr');
    expect(encodedSeries).toHaveProperty('bike:49904:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:7153:rotations');
    expect(encodedSeries).not.toHaveProperty('bike:28812:rotations');
  });

  it('should accept sessions with real HR data', () => {
    const pm = new PersistenceManager();
    const payload = {
      startTime: Date.now() - 120000,
      endTime: Date.now(),
      roster: [{ id: 'alice', name: 'Alice' }],
      deviceAssignments: [{ deviceId: '28688', userId: 'alice' }],
      timeline: {
        timebase: { tickCount: 6 },
        series: {
          'alice:hr': [120, 125, 130, 128, 132, 135],
          'alice:zone': ['active', '', '', '', '', ''],
          'alice:coins': [0, 1, 2, 3, 4, 5],
        }
      }
    };

    const result = pm.validateSessionPayload(payload);
    expect(result.ok).toBe(true);
  });
});
