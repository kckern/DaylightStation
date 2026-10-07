import { describe, expect, it, vi } from 'vitest';

describe('Skyline audio', () => {
  it('primes from a gesture, starts wind, and mutes the actual master gain', async () => {
    const master = { gain: { value: 1 }, connect: vi.fn() };
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = {
      state: 'suspended', destination: {}, currentTime: 0,
      resume: vi.fn(async () => {}), createGain: vi.fn(() => master),
      createOscillator: vi.fn(() => oscillator),
    };
    const { createSkylineAudio } = await import('./skylineAudio.js');
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });

    expect(await audio.prime()).toBe(true);
    expect(audio.startWind()).toBe(true);
    expect(oscillator.start).toHaveBeenCalledOnce();
    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
  });

  it('reports that a cue did not execute when audio is unavailable or muted', async () => {
    const { createSkylineAudio } = await import('./skylineAudio.js');
    const unavailable = createSkylineAudio({ AudioContextCtor: null });
    expect(unavailable.playCue('bell')).toBe(false);

    const master = { gain: { value: 1 }, connect: vi.fn() };
    const context = { state: 'running', destination: {}, currentTime: 0, resume: vi.fn(), createGain: vi.fn(() => master), createOscillator: vi.fn() };
    const muted = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });
    await muted.prime();
    muted.setMuted(true);
    expect(muted.playCue('bell')).toBe(false);
  });
});
