import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('@/lib/api.mjs', () => ({ DaylightMediaPath: (p) => p }));
const warn = vi.fn();
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: (...a) => warn(...a), error: noop, sampled: noop };
  return { default: () => logger };
});

import { useGovernanceAudioDuck } from './useGovernanceAudioDuck.js';
import { __resetCueAudioForTest } from './audioCuePlayer.js';

class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src; this.paused = true; this.playCalls = 0; this.pauseCalls = 0; this._l = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(e, cb) { (this._l[e] ||= []).push(cb); }
  removeEventListener(e, cb) { this._l[e] = (this._l[e] || []).filter((f) => f !== cb); }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.pauseCalls += 1; this.paused = true; }
  fire(e) { (this._l[e] || []).forEach((cb) => cb()); }
}

const descriptor = (o = {}) => ({
  cueId: 'challenge_hurry', sound: 'apps/fitness/ux/challenge-hurry.mp3',
  duckTo: 0.1, token: 'ch1:challenge_hurry', ...o,
});

describe('useGovernanceAudioDuck', () => {
  let videoVolume;
  beforeEach(() => {
    FakeAudio.instances = [];
    global.Audio = FakeAudio;
    __resetCueAudioForTest();
    videoVolume = { setDuck: vi.fn(), volumeRef: { current: 1 } };
  });
  afterEach(() => vi.restoreAllMocks());

  const render = (audioDuck) =>
    renderHook(({ audioDuck }) => useGovernanceAudioDuck({ videoVolume, audioDuck }), {
      initialProps: { audioDuck },
    });

  it('ducks (via setDuck) and plays the SFX on a new token', () => {
    render(descriptor());
    expect(videoVolume.setDuck).toHaveBeenCalledWith(0.1);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it('does NOT re-duck or cut the SFX when the descriptor object changes but the token is unchanged', () => {
    const { rerender } = render(descriptor());
    const sfx = FakeAudio.instances[0];
    for (let i = 0; i < 3; i++) rerender({ audioDuck: descriptor() });
    expect(videoVolume.setDuck).toHaveBeenCalledTimes(1);
    expect(sfx.pauseCalls).toBe(0);
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('lifts the duck (setDuck(1)) when the SFX ends', () => {
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('ended'));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('lifts the duck if autoplay rejects', async () => {
    global.Audio = class extends FakeAudio { play() { this.playCalls += 1; return Promise.reject(new Error('blocked')); } };
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('reuses one shared element and re-ducks on a new token', () => {
    const { rerender } = render(descriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start', duckTo: 0.2 }));
    rerender({ audioDuck: descriptor({ token: 'ch1:challenge_hurry', duckTo: 0.1 }) });
    expect(FakeAudio.instances).toHaveLength(1);        // shared element, not recreated
    expect(FakeAudio.instances[0].playCalls).toBe(2);   // played again for the new cue
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(0.1);
  });

  it('lifts the duck on unmount mid-cue', () => {
    const { unmount } = render(descriptor());
    unmount();
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });

  it('logs the rejection reason when play() is rejected', async () => {
    warn.mockClear();
    global.Audio = class extends FakeAudio {
      play() { this.playCalls += 1; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
    };
    render(descriptor());
    await act(async () => { await Promise.resolve(); });
    expect(warn).toHaveBeenCalledWith('fitness.audio_duck.play_rejected',
      expect.objectContaining({ cueId: 'challenge_hurry', name: 'NotAllowedError' }));
  });

  it('logs + lifts the duck when the audio element fires error', () => {
    warn.mockClear();
    render(descriptor());
    act(() => FakeAudio.instances[0].fire('error'));
    expect(warn).toHaveBeenCalledWith('fitness.audio_duck.error', expect.objectContaining({ cueId: 'challenge_hurry' }));
    expect(videoVolume.setDuck).toHaveBeenLastCalledWith(1);
  });
});
