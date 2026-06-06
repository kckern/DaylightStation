import { describe, it, expect, vi, beforeEach } from 'vitest';

class FakeAudio {
  static instances = [];
  constructor() { this.src = ''; this.muted = false; this.currentTime = 0; this.paused = true; this.playCalls = 0; FakeAudio.instances.push(this); }
  play() { this.playCalls += 1; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
}

vi.mock('@/lib/logging/Logger.js', () => {
  const noop = () => {};
  const logger = { child: () => logger, debug: noop, info: noop, warn: noop, error: noop, sampled: noop };
  return { default: () => logger };
});

import { getCueAudioElement, primeCueAudio, isCueAudioUnlocked, installCueAudioUnlock, __resetCueAudioForTest } from './audioCuePlayer.js';

describe('audioCuePlayer', () => {
  beforeEach(() => { FakeAudio.instances = []; global.Audio = FakeAudio; __resetCueAudioForTest(); });

  it('returns a single shared element across calls', () => {
    expect(getCueAudioElement()).toBe(getCueAudioElement());
    expect(FakeAudio.instances).toHaveLength(1);
  });

  it('primeCueAudio plays-muted-then-pauses and marks unlocked', async () => {
    expect(isCueAudioUnlocked()).toBe(false);
    primeCueAudio();
    await Promise.resolve();
    const el = getCueAudioElement();
    expect(el.playCalls).toBe(1);
    expect(el.paused).toBe(true);
    expect(isCueAudioUnlocked()).toBe(true);
  });

  it('installCueAudioUnlock primes on the first gesture then removes its listeners', async () => {
    const handlers = {};
    const target = {
      addEventListener: (e, cb) => { handlers[e] = cb; },
      removeEventListener: (e) => { delete handlers[e]; },
    };
    installCueAudioUnlock(target);
    expect(Object.keys(handlers).length).toBeGreaterThan(0);
    handlers.pointerdown();
    await Promise.resolve();
    expect(isCueAudioUnlocked()).toBe(true);
    expect(Object.keys(handlers).length).toBe(0);
  });

  it('installCueAudioUnlock is a no-op once already unlocked', () => {
    primeCueAudio();
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    installCueAudioUnlock(target);
    expect(target.addEventListener).not.toHaveBeenCalled();
  });

  it('rolls back unlock and re-arms listeners when play() rejects, allowing a later gesture to retry', async () => {
    // play() rejects → optimistic unlock must roll back, listeners must be re-armed
    global.Audio = class extends FakeAudio { play() { this.playCalls += 1; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); } };
    __resetCueAudioForTest();
    const handlers = {};
    const target = { addEventListener: (e, cb) => { handlers[e] = cb; }, removeEventListener: (e) => { delete handlers[e]; } };
    installCueAudioUnlock(target);
    handlers.pointerdown();
    await Promise.resolve(); await Promise.resolve();
    expect(isCueAudioUnlocked()).toBe(false);                 // rolled back
    expect(Object.keys(handlers).length).toBeGreaterThan(0);  // re-armed

    // Now a gesture where play() resolves should unlock. The element is cached,
    // so patch its play() directly to resolve for the retry leg.
    getCueAudioElement().play = () => Promise.resolve();
    handlers.pointerdown();
    await Promise.resolve();
    expect(isCueAudioUnlocked()).toBe(true);
  });
});
