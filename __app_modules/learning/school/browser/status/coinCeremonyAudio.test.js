import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ master: 0.5 }));
vi.mock("../../../../../frontend/src/lib/volume/ScreenVolumeContext.js", () => ({ getEffectiveMaster: () => h.master }));
import { DaylightMediaPath } from "../../../../../frontend/src/lib/api.mjs";
import { playCoinCue, installCoinCueUnlock, __resetCoinCueForTest } from './coinCeremonyAudio.js';

class FakeAudio {
  constructor() { FakeAudio.last = this; this.src = ''; this.volume = 1; this.muted = false; this.currentTime = 0; this.plays = 0; this.pauses = 0; }
  play() { this.plays += 1; return Promise.resolve(); }
  pause() { this.pauses += 1; }
}

beforeEach(() => { __resetCoinCueForTest(); FakeAudio.last = null; vi.stubGlobal('Audio', FakeAudio); h.master = 0.5; });
afterEach(() => { vi.unstubAllGlobals(); });

describe('playCoinCue', () => {
  it('plays the configured file from the media mount, scaled by the screen master', () => {
    expect(playCoinCue({ sound: 'school/_ux/coin.mp3', volume: 0.8 })).toBe(true);
    expect(FakeAudio.last.src).toBe(DaylightMediaPath('/media/school/_ux/coin.mp3'));
    expect(FakeAudio.last.src).toContain('/api/v1/proxy/media/school/_ux/coin.mp3');
    expect(FakeAudio.last.volume).toBeCloseTo(0.4);
    expect(FakeAudio.last.plays).toBe(1);
  });
  it('a muted master, or no sound, plays nothing', () => {
    expect(playCoinCue({ sound: null })).toBe(false);
    h.master = 0;
    expect(playCoinCue({ sound: 'school/_ux/coin.mp3' })).toBe(false);
    expect(FakeAudio.last).toBeNull();
  });
});

describe('installCoinCueUnlock', () => {
  it('primes the element on the first gesture, then stops listening', () => {
    const target = new EventTarget();
    const off = installCoinCueUnlock(target);
    target.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudio.last.plays).toBe(1);
    expect(FakeAudio.last.pauses).toBe(1);
    expect(FakeAudio.last.muted).toBe(false);
    target.dispatchEvent(new Event('keydown'));
    expect(FakeAudio.last.plays).toBe(1);
    off();
  });
  it('sets the cue source before the muted prime play()', () => {
    const order = [];
    class OrderAudio extends FakeAudio {
      set src(v) { order.push('src'); this._src = v; }
      get src() { return this._src; }
      play() { order.push('play'); return super.play(); }
    }
    vi.stubGlobal('Audio', OrderAudio);
    const target = new EventTarget();
    installCoinCueUnlock(target, { sound: 'school/_ux/coin.mp3' });
    target.dispatchEvent(new Event('click'));
    expect(order.slice(-2)).toEqual(['src', 'play']);
    expect(FakeAudio.last.src).toBe(DaylightMediaPath('/media/school/_ux/coin.mp3'));
  });
  it('repeated installs share one listener set', () => {
    const target = new EventTarget();
    const add = vi.spyOn(target, 'addEventListener');
    const off1 = installCoinCueUnlock(target);
    const off2 = installCoinCueUnlock(target);
    expect(off2).toBe(off1);
    expect(add).toHaveBeenCalledTimes(4);
    off1();
  });
  it('a rejected prime re-arms the listeners', async () => {
    class RejectAudio extends FakeAudio { play() { this.plays += 1; return Promise.reject(Object.assign(new Error('x'), { name: 'NotSupportedError' })); } }
    vi.stubGlobal('Audio', RejectAudio);
    const target = new EventTarget();
    installCoinCueUnlock(target);
    target.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve(); await Promise.resolve();
    target.dispatchEvent(new Event('pointerdown'));
    expect(FakeAudio.last.plays).toBe(2);
  });
});
