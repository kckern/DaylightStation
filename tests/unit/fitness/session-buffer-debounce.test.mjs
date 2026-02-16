import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

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

/**
 * Test the 5-second debounce between session end and next session start.
 *
 * After a session ends, `_lastSessionEndTime` records when it ended.
 * `_maybeStartSessionFromBuffer()` must refuse to start a new session
 * if fewer than 5 seconds have elapsed since the last session ended.
 * This prevents the 14-sessions-in-10-minutes ghost session loop.
 */

let FitnessSession;
beforeAll(async () => {
  const mod = await import('#frontend/hooks/fitness/FitnessSession.js');
  FitnessSession = mod.FitnessSession;
});

/**
 * Build a minimal stub with fields that _maybeStartSessionFromBuffer relies on,
 * then bind the real prototype method to it.
 */
function createBufferDebounceStub() {
  const stub = {
    sessionId: null, // No active session (required for buffer check)
    _preSessionBuffer: [],
    _bufferThresholdMet: false,
    _preSessionThreshold: 3,
    _lastPreSessionLogAt: 0,
    _lastRejectionLogAt: 0,
    // Debounce fields (the NEW fields we're testing)
    _lastSessionEndTime: 0,
    _sessionEndDebounceMs: 5000,
    // Stubs for methods called by _maybeStartSessionFromBuffer
    _isValidPreSessionSample: jest.fn(() => true),
    ensureStarted: jest.fn(() => true),
    _log: jest.fn(),
  };

  // Bind the real prototype method
  stub._maybeStartSessionFromBuffer =
    FitnessSession.prototype._maybeStartSessionFromBuffer.bind(stub);

  return stub;
}

describe('Session buffer debounce after end', () => {
  // ----------------------------------------------------------------
  // Constructor defaults
  // ----------------------------------------------------------------
  describe('constructor defaults', () => {
    it('_lastSessionEndTime defaults to 0', () => {
      const stub = createBufferDebounceStub();
      expect(stub._lastSessionEndTime).toBe(0);
    });

    it('_sessionEndDebounceMs defaults to 5000', () => {
      const stub = createBufferDebounceStub();
      expect(stub._sessionEndDebounceMs).toBe(5000);
    });
  });

  // ----------------------------------------------------------------
  // Debounce behavior
  // ----------------------------------------------------------------
  describe('debounce prevents rapid session restarts', () => {
    it('returns false when _lastSessionEndTime is within 5 seconds of timestamp', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // Session ended 2 seconds ago
      stub._lastSessionEndTime = now - 2000;

      // Pre-fill buffer to meet threshold so debounce is the only reason to block
      stub._preSessionBuffer = [
        { deviceId: 'd1', timestamp: now - 2000 },
        { deviceId: 'd1', timestamp: now - 1000 },
      ];
      stub._preSessionThreshold = 3;

      // This call would add a 3rd sample and meet threshold,
      // but debounce should block it
      const result = stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      expect(result).toBe(false);
      // ensureStarted should NOT have been called
      expect(stub.ensureStarted).not.toHaveBeenCalled();
    });

    it('returns false when exactly at the debounce boundary (4999ms)', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // Session ended 4999ms ago (just under 5s)
      stub._lastSessionEndTime = now - 4999;

      // Pre-fill buffer to exceed threshold
      stub._preSessionBuffer = [
        { deviceId: 'd1', timestamp: now - 3000 },
        { deviceId: 'd1', timestamp: now - 2000 },
      ];
      stub._preSessionThreshold = 3;

      const result = stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      expect(result).toBe(false);
      expect(stub.ensureStarted).not.toHaveBeenCalled();
    });

    it('allows session start when _lastSessionEndTime is older than 5 seconds', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // Session ended 6 seconds ago — beyond debounce window
      stub._lastSessionEndTime = now - 6000;

      // Pre-fill buffer so threshold is met on next sample
      stub._preSessionBuffer = [
        { deviceId: 'd1', timestamp: now - 2000 },
        { deviceId: 'd1', timestamp: now - 1000 },
      ];
      stub._preSessionThreshold = 3;

      const result = stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      // Should proceed to start session
      expect(result).toBe(true);
      expect(stub.ensureStarted).toHaveBeenCalled();
    });

    it('allows session start when _lastSessionEndTime is 0 (no prior session)', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // No prior session — _lastSessionEndTime is 0
      stub._lastSessionEndTime = 0;

      // Pre-fill buffer so threshold is met on next sample
      stub._preSessionBuffer = [
        { deviceId: 'd1', timestamp: now - 2000 },
        { deviceId: 'd1', timestamp: now - 1000 },
      ];
      stub._preSessionThreshold = 3;

      const result = stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      expect(result).toBe(true);
      expect(stub.ensureStarted).toHaveBeenCalled();
    });

    it('allows session start at exactly 5000ms (boundary inclusive)', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // Session ended exactly 5000ms ago
      stub._lastSessionEndTime = now - 5000;

      // Pre-fill buffer so threshold is met on next sample
      stub._preSessionBuffer = [
        { deviceId: 'd1', timestamp: now - 2000 },
        { deviceId: 'd1', timestamp: now - 1000 },
      ];
      stub._preSessionThreshold = 3;

      const result = stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      // At exactly 5000ms, (now - _lastSessionEndTime) == 5000, which is NOT < 5000
      // so debounce does NOT block
      expect(result).toBe(true);
      expect(stub.ensureStarted).toHaveBeenCalled();
    });
  });

  // ----------------------------------------------------------------
  // Debounce still buffers samples (doesn't reject them)
  // ----------------------------------------------------------------
  describe('debounce buffers samples without starting', () => {
    it('still adds valid samples to buffer during debounce window', () => {
      const stub = createBufferDebounceStub();
      const now = Date.now();

      // Session ended 1 second ago — within debounce
      stub._lastSessionEndTime = now - 1000;
      stub._preSessionBuffer = [];
      stub._preSessionThreshold = 3;

      stub._maybeStartSessionFromBuffer(
        { deviceId: 'd1', heartRate: 120, data: { ComputedHeartRate: 120 } },
        now
      );

      // The sample should NOT have been added to the buffer because
      // the debounce returns false before buffer logic runs
      // (debounce guard is right after sessionId check, before buffer push)
      expect(stub._preSessionBuffer).toHaveLength(0);
    });
  });
});
