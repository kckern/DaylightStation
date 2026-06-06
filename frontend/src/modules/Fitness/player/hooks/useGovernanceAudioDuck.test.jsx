import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Resolve sound paths to a stable string so we can assert without a backend.
vi.mock('@/lib/api.mjs', () => ({
  DaylightMediaPath: (p) => p,
}));

// Silence the structured logger (this suite asserts on behavior, not logs).
vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { useGovernanceAudioDuck } from './useGovernanceAudioDuck.js';

// Fake HTMLAudioElement that records lifecycle calls and lets tests fire events.
class FakeAudio {
  static instances = [];
  constructor(src) {
    this.src = src;
    this.paused = true;
    this.playCalls = 0;
    this.pauseCalls = 0;
    this._listeners = {};
    FakeAudio.instances.push(this);
  }
  addEventListener(evt, cb) {
    (this._listeners[evt] ||= []).push(cb);
  }
  removeEventListener(evt, cb) {
    this._listeners[evt] = (this._listeners[evt] || []).filter((f) => f !== cb);
  }
  play() {
    this.playCalls += 1;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.pauseCalls += 1;
    this.paused = true;
  }
  fire(evt) {
    (this._listeners[evt] || []).forEach((cb) => cb());
  }
}

const duckDescriptor = (overrides = {}) => ({
  cueId: 'challenge_hurry',
  sound: 'apps/fitness/ux/challenge-hurry.mp3',
  duckTo: 0.1,
  token: 'ch1:challenge_hurry',
  ...overrides,
});

describe('useGovernanceAudioDuck', () => {
  let media;
  let videoVolume;

  beforeEach(() => {
    FakeAudio.instances = [];
    global.Audio = FakeAudio;
    media = { volume: 1 };
    videoVolume = { volumeRef: { current: 1 } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const render = (audioDuck) =>
    renderHook(({ audioDuck }) => useGovernanceAudioDuck({ mediaElement: media, videoVolume, audioDuck }), {
      initialProps: { audioDuck },
    });

  it('ducks and plays the SFX when a cue token first appears', () => {
    render(duckDescriptor());
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].playCalls).toBe(1);
    expect(media.volume).toBeCloseTo(0.1, 5);
  });

  it('does NOT cut the SFX or restore volume when the descriptor object changes but the token is unchanged', () => {
    // The governance engine rebuilds `audioDuck` as a fresh object every tick.
    // A new object identity with the SAME token must NOT tear down the in-flight
    // SFX or prematurely restore the ducked volume.
    const { rerender } = render(duckDescriptor());
    const sfx = FakeAudio.instances[0];

    // Three more ticks: same token, new object identity each time.
    for (let i = 0; i < 3; i++) {
      rerender({ audioDuck: duckDescriptor() });
    }

    expect(sfx.pauseCalls).toBe(0); // SFX never cut mid-play
    expect(FakeAudio.instances).toHaveLength(1); // no replay
    expect(media.volume).toBeCloseTo(0.1, 5); // volume stays ducked — no jump
  });

  it('restores volume only when the SFX naturally ends', () => {
    const { rerender } = render(duckDescriptor());
    const sfx = FakeAudio.instances[0];
    rerender({ audioDuck: duckDescriptor() }); // churn tick
    expect(media.volume).toBeCloseTo(0.1, 5);

    act(() => sfx.fire('ended'));
    expect(media.volume).toBeCloseTo(1, 5);
  });

  it('never raises volume above the viewer level during a duck', () => {
    const { rerender } = render(duckDescriptor());
    // Simulate many ticks across the whole threshold window.
    for (let i = 0; i < 10; i++) rerender({ audioDuck: duckDescriptor() });
    expect(media.volume).toBeLessThanOrEqual(1);
    expect(media.volume).toBeCloseTo(0.1, 5);
  });

  it('restores volume if autoplay rejects (SFX never ends)', async () => {
    global.Audio = class extends FakeAudio {
      play() {
        this.playCalls += 1;
        return Promise.reject(new Error('autoplay blocked'));
      }
    };
    render(duckDescriptor());
    await act(async () => { await Promise.resolve(); });
    expect(media.volume).toBeCloseTo(1, 5);
  });

  it('stops the previous SFX when a new token arrives (no orphan stream)', () => {
    const { rerender } = render(duckDescriptor({ token: 'ch1:challenge_start', cueId: 'challenge_start' }));
    const first = FakeAudio.instances[0];
    rerender({ audioDuck: duckDescriptor({ token: 'ch1:challenge_hurry', cueId: 'challenge_hurry' }) });
    expect(first.pauseCalls).toBeGreaterThanOrEqual(1);
    expect(FakeAudio.instances).toHaveLength(2);
    expect(FakeAudio.instances[1].playCalls).toBe(1);
  });

  it('restores volume on unmount mid-duck', () => {
    const { unmount } = render(duckDescriptor());
    expect(media.volume).toBeCloseTo(0.1, 5);
    unmount();
    expect(media.volume).toBeCloseTo(1, 5);
  });
});
