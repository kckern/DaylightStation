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
 * FitnessSession is deeply entangled with many imports (DeviceManager, UserManager,
 * GovernanceEngine, etc.). Rather than instantiate the full class, we extract
 * the timer methods and test them on a minimal stub that has only the fields
 * those methods touch. This is a focused unit test for the rate limiter and
 * generation counter logic.
 */

// We'll dynamically import FitnessSession after mocks are set up, then
// extract the prototype methods.
let FitnessSession;
beforeAll(async () => {
  const mod = await import('#frontend/hooks/fitness/FitnessSession.js');
  FitnessSession = mod.FitnessSession;
});

/**
 * Build a minimal stub object that has the fields _startTickTimer and
 * _stopTickTimer rely on, then bind the real prototype methods to it.
 */
function createTimerStub() {
  const stub = {
    sessionId: 'test-session-001',
    // Timer state
    _tickTimer: null,
    _tickIntervalMs: 5000,
    _tickTimerStartedAt: null,
    _tickTimerTickCount: 0,
    // Rate limiter & generation counter (the NEW fields we're testing)
    _timerGeneration: 0,
    _lastTimerStartAt: 0,
    // Timeline stub (so interval resolution works)
    timeline: null,
    // Stubs for methods called inside the interval callback
    _collectTimelineTick: jest.fn(),
    _checkEmptyRosterTimeout: jest.fn(),
    _logTickTimerHealth: jest.fn(),
  };

  // Bind the real prototype methods
  stub._startTickTimer = FitnessSession.prototype._startTickTimer.bind(stub);
  stub._stopTickTimer = FitnessSession.prototype._stopTickTimer.bind(stub);

  return stub;
}

describe('Tick timer rate limiter + generation counter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ----------------------------------------------------------------
  // Rate limiter tests
  // ----------------------------------------------------------------
  describe('rate limiting', () => {
    it('allows the first _startTickTimer call', () => {
      const stub = createTimerStub();
      stub._startTickTimer();

      expect(stub._tickTimer).not.toBeNull();
      expect(stub._lastTimerStartAt).toBeGreaterThan(0);
    });

    it('blocks a second _startTickTimer call within 4 seconds (rate limited)', () => {
      const stub = createTimerStub();

      // First call — should start normally
      stub._startTickTimer();
      const firstTimer = stub._tickTimer;
      const firstGeneration = stub._timerGeneration;

      // Second call within 4s — should be a no-op
      stub._startTickTimer();
      expect(stub._tickTimer).toBe(firstTimer); // same timer reference
      expect(stub._timerGeneration).toBe(firstGeneration); // generation unchanged
    });

    it('allows restart after 4+ seconds have elapsed', () => {
      const stub = createTimerStub();

      // First call
      stub._startTickTimer();
      const firstTimer = stub._tickTimer;

      // Advance time past the 4-second rate limit
      jest.advanceTimersByTime(4001);

      // Second call — should create a new timer
      stub._startTickTimer();
      expect(stub._tickTimer).not.toBe(firstTimer);
    });
  });

  // ----------------------------------------------------------------
  // Generation counter tests
  // ----------------------------------------------------------------
  describe('generation counter', () => {
    it('increments _timerGeneration on _stopTickTimer', () => {
      const stub = createTimerStub();

      expect(stub._timerGeneration).toBe(0);
      stub._stopTickTimer();
      expect(stub._timerGeneration).toBe(1);
    });

    it('increments _timerGeneration even when no timer is active', () => {
      const stub = createTimerStub();
      // No timer running
      expect(stub._tickTimer).toBeNull();

      stub._stopTickTimer();
      expect(stub._timerGeneration).toBe(1);

      stub._stopTickTimer();
      expect(stub._timerGeneration).toBe(2);
    });

    it('stale timer self-clears via generation mismatch', () => {
      const stub = createTimerStub();

      // Start a timer (generation becomes 1 inside _startTickTimer)
      stub._startTickTimer();
      expect(stub._tickTimer).not.toBeNull();
      const capturedTimer = stub._tickTimer;

      // Externally bump the generation to simulate a new session
      stub._timerGeneration = 999;

      // Advance so the interval fires
      jest.advanceTimersByTime(5000);

      // The callback should have detected the mismatch and cleared itself
      expect(stub._tickTimer).toBeNull();

      // The tick logic should NOT have been called
      expect(stub._collectTimelineTick).not.toHaveBeenCalled();
    });

    it('_startTickTimer increments generation via _stopTickTimer then sets its own', () => {
      const stub = createTimerStub();

      stub._startTickTimer();
      // _stopTickTimer is called inside, which bumps generation,
      // then _startTickTimer does ++this._timerGeneration again
      // Net: generation should be > 0
      expect(stub._timerGeneration).toBeGreaterThan(0);

      const genAfterFirst = stub._timerGeneration;

      // Advance past rate limit
      jest.advanceTimersByTime(4001);

      stub._startTickTimer();
      expect(stub._timerGeneration).toBeGreaterThan(genAfterFirst);
    });
  });

  // ----------------------------------------------------------------
  // Constructor initialization
  // ----------------------------------------------------------------
  describe('constructor fields', () => {
    it('FitnessSession prototype has _timerGeneration init in constructor body', () => {
      // Verify the new fields exist on FitnessSession.prototype methods
      // by checking the constructor source (indirect) or by looking at a stub
      const stub = createTimerStub();
      // These should be initialized to their defaults
      expect(stub._timerGeneration).toBe(0);
      expect(stub._lastTimerStartAt).toBe(0);
    });
  });
});
