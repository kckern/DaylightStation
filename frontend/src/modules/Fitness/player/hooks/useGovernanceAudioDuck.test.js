import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGovernanceAudioDuck } from './useGovernanceAudioDuck.js';

// Fake Audio that records instances and lets the test fire 'ended'.
class FakeAudio {
  constructor(src) {
    this.src = src;
    this.volume = 1;
    this._listeners = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(type, cb) { (this._listeners[type] ||= []).push(cb); }
  removeEventListener(type, cb) {
    this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== cb);
  }
  play() { this.played = true; return Promise.resolve(); }
  pause() { this.paused = true; }
  fire(type) { (this._listeners[type] || []).forEach((cb) => cb()); }
}
FakeAudio.instances = [];

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
});
afterEach(() => { vi.unstubAllGlobals(); });

const makeMedia = (volume = 0.6) => ({ volume });
const makeVolume = (level = 0.6) => ({ volumeRef: { current: level } });
const duck = (token) => ({ cueId: 'challenge_hurry', sound: 'apps/fitness/ux/challenge-hurry.mp3', duckTo: 0.1, token });

describe('useGovernanceAudioDuck', () => {
  it('plays the SFX and ducks media volume multiplicatively on a new token', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].played).toBe(true);
    expect(media.volume).toBeCloseTo(0.06); // 0.6 * 0.1
  });

  it('restores media volume to the live persistent level when the SFX ends', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    // User nudged volume up during the duck; restore must use the live ref.
    videoVolume.volumeRef.current = 0.8;
    FakeAudio.instances[0].fire('ended');
    expect(media.volume).toBeCloseTo(0.8);
  });

  it('does not refire for the same token', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const { rerender } = renderHook(
      ({ d }) => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: d }),
      { initialProps: { d: duck('ch1:challenge_hurry') } }
    );
    rerender({ d: duck('ch1:challenge_hurry') });
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('is a no-op when audioDuck is null', () => {
    const media = makeMedia(0.6);
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume: makeVolume(0.6), audioDuck: null }));
    expect(FakeAudio.instances).toHaveLength(0);
    expect(media.volume).toBe(0.6);
  });

  it('restores volume on unmount if still ducked', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const { unmount } = renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    expect(media.volume).toBeCloseTo(0.06);
    unmount();
    expect(media.volume).toBeCloseTo(0.6);
  });

  it('stops the previous SFX and re-ducks when a new token arrives mid-play', () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const { rerender } = renderHook(
      ({ d }) => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: d }),
      { initialProps: { d: duck('ch1:challenge_hurry') } }
    );
    const first = FakeAudio.instances[0];
    rerender({ d: duck('ch2:challenge_hurry') });
    expect(first.paused).toBe(true);          // previous SFX stopped
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[1].played).toBe(true);
    expect(media.volume).toBeCloseTo(0.06);   // still ducked for token B
  });

  it('restores volume if SFX playback is rejected (autoplay blocked)', async () => {
    const media = makeMedia(0.6);
    const videoVolume = makeVolume(0.6);
    const playSpy = vi.spyOn(FakeAudio.prototype, 'play').mockReturnValueOnce(Promise.reject(new Error('NotAllowed')));
    renderHook(() => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck: duck('ch1:challenge_hurry') }));
    expect(media.volume).toBeCloseTo(0.06);   // ducked synchronously
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(media.volume).toBeCloseTo(0.6);    // restored after rejection
    playSpy.mockRestore();
  });
});
