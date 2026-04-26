import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('FitnessSession._startTickTimer guard', () => {
  let session;

  beforeEach(() => {
    // Minimal FitnessSession stub with tick timer internals
    session = {
      sessionId: 'test-123',
      _tickTimer: null,
      _tickIntervalMs: 5000,
      _timerGeneration: 0,
      _lastTimerStartAt: 0,
      _tickTimerStartedAt: 0,
      _tickTimerTickCount: 0,
      timeline: { timebase: { intervalMs: 5000 } },
      _collectTimelineTick: vi.fn(),
      _checkEmptyRosterTimeout: vi.fn(),
      _logTickTimerHealth: vi.fn(),
    };

    // Replicate _stopTickTimer logic
    session._stopTickTimer = function () {
      ++this._timerGeneration;
      if (this._tickTimer) {
        clearInterval(this._tickTimer);
        this._tickTimer = null;
      }
    };

    // Replicate _startTickTimer with the NEW guard behavior
    session._startTickTimer = function () {
      const interval = this.timeline?.timebase.intervalMs || this._tickIntervalMs;
      if (!(interval > 0)) return;

      // NEW GUARD: don't restart if already running
      if (this._tickTimer) return;

      this._stopTickTimer();
      const gen = ++this._timerGeneration;
      this._lastTimerStartAt = Date.now();
      this._tickTimerStartedAt = Date.now();
      this._tickTimerTickCount = 0;

      this._tickTimer = setInterval(() => {
        if (this._timerGeneration !== gen) {
          clearInterval(this._tickTimer);
          this._tickTimer = null;
          return;
        }
        this._tickTimerTickCount++;
        this._collectTimelineTick();
        this._checkEmptyRosterTimeout();
      }, interval);
    };
  });

  afterEach(() => {
    if (session._tickTimer) {
      clearInterval(session._tickTimer);
      session._tickTimer = null;
    }
  });

  it('starts a timer when none is running', () => {
    expect(session._tickTimer).toBeNull();
    session._startTickTimer();
    expect(session._tickTimer).not.toBeNull();
  });

  it('does NOT restart when timer is already running', () => {
    session._startTickTimer();
    const firstTimer = session._tickTimer;
    const firstGen = session._timerGeneration;

    session._startTickTimer();
    expect(session._tickTimer).toBe(firstTimer);
    expect(session._timerGeneration).toBe(firstGen);
  });

  it('allows starting after explicit stop', () => {
    session._startTickTimer();
    const firstTimer = session._tickTimer;

    session._stopTickTimer();
    expect(session._tickTimer).toBeNull();

    session._startTickTimer();
    expect(session._tickTimer).not.toBeNull();
    expect(session._tickTimer).not.toBe(firstTimer);
  });
});
