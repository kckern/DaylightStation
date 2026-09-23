import { describe, it, expect, vi } from 'vitest';
import { enforceGovernanceOnProgress } from './governanceProgressEnforcer.js';

const make = (locked) => {
  const state = { locked };
  return {
    state,
    deps: {
      isGovernanceLocked: () => state.locked,
      pausePlayback: vi.fn(),
      setVideoPlayerPaused: vi.fn(),
      onEnforced: vi.fn(),
    },
  };
};

describe('enforceGovernanceOnProgress', () => {
  it('pauses a playing video while governance is locked', () => {
    const { deps } = make(true);
    enforceGovernanceOnProgress({ paused: false }, deps);
    expect(deps.pausePlayback).toHaveBeenCalledTimes(1);
    expect(deps.onEnforced).toHaveBeenCalledTimes(1);
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(true);
  });

  it('never pauses when governance is clear — play means play', () => {
    const { deps } = make(false);
    enforceGovernanceOnProgress({ paused: false }, deps);
    expect(deps.pausePlayback).not.toHaveBeenCalled();
    expect(deps.onEnforced).not.toHaveBeenCalled();
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(false);
  });

  it('reads governance at call time, not when the handler was created', () => {
    // The 2026-09-22 failure: a handler created while locked kept pausing after unlock.
    const { state, deps } = make(true);
    const handler = (progress) => enforceGovernanceOnProgress(progress, deps);
    state.locked = false; // governance unlocks AFTER the handler exists
    handler({ paused: false });
    expect(deps.pausePlayback).not.toHaveBeenCalled();
  });

  it('does not re-pause an already paused video, and reports the real paused state', () => {
    const { deps } = make(true);
    enforceGovernanceOnProgress({ paused: true }, deps);
    expect(deps.pausePlayback).not.toHaveBeenCalled();
    expect(deps.setVideoPlayerPaused).toHaveBeenCalledWith(true);
  });

  it('tolerates missing optional deps', () => {
    expect(() => enforceGovernanceOnProgress({ paused: false }, { isGovernanceLocked: () => true })).not.toThrow();
  });
});
