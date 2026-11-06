import { describe, it, expect, vi } from 'vitest';
import { createBleepTone, BLEEP_HZ } from './bleepTone.js';

function fakeCtx(state = 'running') {
  const param = () => ({ value: 0, setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() });
  const ctx = {
    state, currentTime: 10, destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({ gain: param(), connect: vi.fn(), disconnect: vi.fn() })),
    createOscillator: vi.fn(() => ({ type: '', frequency: param(), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
  };
  return ctx;
}

describe('createBleepTone', () => {
  it('starts a 1000 Hz sine with a gain ramp in, and ramps out on stop', () => {
    const ctx = fakeCtx();
    const tone = createBleepTone({ createContext: () => ctx });
    expect(tone.start()).toBe(true);
    const osc = ctx.createOscillator.mock.results[0].value;
    const gain = ctx.createGain.mock.results[0].value;
    expect(BLEEP_HZ).toBe(1000);
    expect(osc.type).toBe('sine');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(1000, 10);
    expect(gain.gain.linearRampToValueAtTime).toHaveBeenCalled();
    expect(osc.start).toHaveBeenCalled();
    tone.stop();
    expect(osc.stop).toHaveBeenCalledWith(expect.any(Number));
    expect(osc.stop.mock.calls[0][0]).toBeGreaterThan(10);
  });
  it('is idempotent: a second start while sounding creates no second oscillator', () => {
    const ctx = fakeCtx();
    const tone = createBleepTone({ createContext: () => ctx });
    tone.start(); tone.start();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
  });
  it('reports degraded and does not sound when the context is suspended', () => {
    const ctx = fakeCtx('suspended');
    const onDegraded = vi.fn();
    const tone = createBleepTone({ createContext: () => ctx, onDegraded });
    expect(tone.start()).toBe(false);
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.createOscillator).not.toHaveBeenCalled();
    expect(onDegraded).toHaveBeenCalledWith('suspended');
  });
  it('reports degraded when Web Audio is unavailable', () => {
    const onDegraded = vi.fn();
    const tone = createBleepTone({ createContext: () => null, onDegraded });
    expect(tone.start()).toBe(false);
    expect(onDegraded).toHaveBeenCalledWith('no-audio-context');
  });
  it('stop without start is a no-op', () => {
    const tone = createBleepTone({ createContext: () => fakeCtx() });
    expect(() => tone.stop()).not.toThrow();
  });
});
