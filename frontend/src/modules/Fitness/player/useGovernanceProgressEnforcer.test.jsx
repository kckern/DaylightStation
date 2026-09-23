import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGovernanceProgressEnforcer } from './governanceProgressEnforcer.js';

const setup = (initialLocked, extra = {}) => {
  const pausePlayback = vi.fn();
  const setVideoPlayerPaused = vi.fn();
  const logger = { sampled: vi.fn() };
  const hook = renderHook(
    ({ governancePaused, getContext }) => useGovernanceProgressEnforcer({
      governancePaused, pausePlayback, setVideoPlayerPaused, logger, getContext,
    }),
    { initialProps: { governancePaused: initialLocked, getContext: extra.getContext } },
  );
  return { ...hook, pausePlayback, setVideoPlayerPaused, logger };
};

describe('useGovernanceProgressEnforcer', () => {
  it('pauses once when locked', () => {
    const { result, pausePlayback, setVideoPlayerPaused } = setup(true);
    result.current.enforce({ paused: false, currentTime: 12 }, 'tick');
    expect(pausePlayback).toHaveBeenCalledTimes(1);
    expect(setVideoPlayerPaused).toHaveBeenCalledWith(true);
  });

  it('a handler captured while locked does not pause after governance unlocks (2026-09-22)', () => {
    const { result, rerender, pausePlayback, setVideoPlayerPaused } = setup(true);
    const capturedEnforce = result.current.enforce;
    rerender({ governancePaused: false });
    capturedEnforce({ paused: false, currentTime: 30 }, 'tick');
    expect(pausePlayback).not.toHaveBeenCalled();
    expect(setVideoPlayerPaused).toHaveBeenCalledWith(false);
  });

  it('keeps enforce and isLocked identity stable across governance changes', () => {
    const { result, rerender } = setup(true);
    const first = result.current;
    rerender({ governancePaused: false });
    expect(result.current.enforce).toBe(first.enforce);
    expect(result.current.isLocked).toBe(first.isLocked);
  });

  it('isLocked reads the live verdict', () => {
    const { result, rerender } = setup(false);
    const { isLocked } = result.current;
    expect(isLocked()).toBe(false);
    rerender({ governancePaused: true });
    expect(isLocked()).toBe(true);
  });

  it('a captured enforce does nothing to pause after unmount', () => {
    const { result, unmount, pausePlayback } = setup(true);
    const capturedEnforce = result.current.enforce;
    const capturedIsLocked = result.current.isLocked;
    unmount();
    capturedEnforce({ paused: false, currentTime: 5 }, 'tick');
    expect(pausePlayback).not.toHaveBeenCalled();
    expect(capturedIsLocked()).toBe(false);
  });

  it('logs pause-enforced with branch, currentTime and a live governance snapshot', () => {
    let status = 'warning';
    const getContext = () => ({ governanceStatus: status, videoLocked: true });
    const { result, logger } = setup(true, { getContext });
    status = 'locked';
    result.current.enforce({ paused: false, currentTime: 42.5 }, 'seek-intent');
    expect(logger.sampled).toHaveBeenCalledTimes(1);
    const [event, data, opts] = logger.sampled.mock.calls[0];
    expect(event).toBe('fitness.governance.pause-enforced');
    expect(data).toEqual({ branch: 'seek-intent', currentTime: 42.5, governanceStatus: 'locked', videoLocked: true });
    expect(opts).toEqual({ maxPerMinute: 10, aggregate: true });
  });

  it('does not log when nothing was enforced', () => {
    const { result, logger } = setup(false);
    result.current.enforce({ paused: false, currentTime: 1 }, 'tick');
    expect(logger.sampled).not.toHaveBeenCalled();
  });
});
