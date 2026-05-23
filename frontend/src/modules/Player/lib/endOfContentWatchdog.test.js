import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEndOfContentWatchdog } from './endOfContentWatchdog.js';

describe('createEndOfContentWatchdog', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  const makeInfo = (overrides = {}) => () => ({
    currentTime: 441.76,
    duration: 441.76,
    paused: true,
    seeking: true,
    ...overrides
  });

  it('fires onAdvance after idleMs of paused-at-duration with no progress', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(2999);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('does not fire when video is playing', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo({ paused: false }),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('does not fire when currentTime is far from duration', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo({ currentTime: 100, duration: 441.76 }),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('resets the timer when currentTime progresses (user scrubbed away from end)', () => {
    const onAdvance = vi.fn();
    let info = { currentTime: 441.7, duration: 441.76, paused: true, seeking: true };
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: () => info,
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(2000);
    // User scrubs to middle of video
    info = { currentTime: 200, duration: 441.76, paused: true, seeking: false };
    wd.tick();
    vi.advanceTimersByTime(5000);
    wd.tick();
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('fires exactly once per arming episode (one-shot guard)', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    wd.tick();
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
  });

  it('re-arms after reset() is called', () => {
    const onAdvance = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance,
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log: vi.fn()
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    expect(onAdvance).toHaveBeenCalledTimes(1);
    wd.reset();
    // After reset, conditions still hold — the caller ticks to re-arm.
    wd.tick();
    vi.advanceTimersByTime(3001);
    expect(onAdvance).toHaveBeenCalledTimes(2);
  });

  it('emits a log event when it fires', () => {
    const log = vi.fn();
    const wd = createEndOfContentWatchdog({
      onAdvance: vi.fn(),
      getMediaInfo: makeInfo(),
      thresholdSeconds: 0.5,
      idleMs: 3000,
      log
    });
    wd.tick();
    vi.advanceTimersByTime(3001);
    wd.tick();
    expect(log).toHaveBeenCalledWith('playback.end-of-content-advance', expect.objectContaining({
      currentTime: 441.76,
      duration: 441.76,
      idleMs: 3000
    }));
  });
});
