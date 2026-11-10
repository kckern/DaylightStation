import { describe, expect, it, vi } from 'vitest';

describe('Skyline audio', () => {
  it('primes from a gesture, starts wind, and mutes the actual master gain', async () => {
    const master = { gain: { value: 1 }, connect: vi.fn() };
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = {
      state: 'suspended', destination: {}, currentTime: 0,
      resume: vi.fn(async () => { context.state = 'running'; }), createGain: vi.fn(() => master),
      createOscillator: vi.fn(() => oscillator),
    };
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });

    expect(await audio.prime()).toBe(true);
    expect(audio.startWind()).toBe(true);
    expect(oscillator.start).toHaveBeenCalledOnce();
    audio.setMuted(true);
    expect(master.gain.value).toBe(0);
  });

  it('reports that a cue did not execute when audio is unavailable or muted', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const unavailable = createSkylineAudio({ AudioContextCtor: null });
    expect(unavailable.playCue('bell')).toBe(false);

    const master = { gain: { value: 1 }, connect: vi.fn() };
    const context = { state: 'running', destination: {}, currentTime: 0, resume: vi.fn(), createGain: vi.fn(() => master), createOscillator: vi.fn() };
    const muted = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });
    await muted.prime();
    muted.setMuted(true);
    expect(muted.playCue('bell')).toBe(false);
  });

  it('does not claim a cue executed while the browser keeps audio suspended', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const master = { gain: { value: 1 }, connect: vi.fn() };
    const context = { state: 'suspended', destination: {}, currentTime: 0, resume: vi.fn(async () => { throw new Error('gesture required'); }), createGain: vi.fn(() => master), createOscillator: vi.fn() };
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });
    expect(await audio.prime()).toBe(false);
    expect(audio.playCue('bell')).toBe(false);
    expect(context.createOscillator).not.toHaveBeenCalled();
  });

  it('plays a zone sound file when one decodes and falls back to synthesis for empty placeholders', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const gain = () => ({ gain: { value: 1 }, connect: vi.fn() });
    const source = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn() };
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = {
      state: 'running', destination: {}, currentTime: 0, resume: vi.fn(),
      createGain: vi.fn(gain), createOscillator: vi.fn(() => oscillator), createBufferSource: vi.fn(() => source),
      decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    };
    const files = { '/bell.mp3': new ArrayBuffer(8), '/crash.mp3': new ArrayBuffer(0) };
    const fetchImpl = vi.fn(async (url) => (url in files
      ? { ok: true, arrayBuffer: async () => files[url] }
      : { ok: false, status: 404 }));
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; }, fetchImpl });
    await audio.prime();

    const report = await audio.loadSounds({ bell: '/bell.mp3', crash: '/crash.mp3', music: '/music.mp3' });

    expect(report.loaded).toEqual(['bell']);
    expect(report.missing).toEqual(expect.arrayContaining([
      { slot: 'crash', url: '/crash.mp3', reason: 'empty' },
      { slot: 'music', url: '/music.mp3', reason: 'http-404' },
    ]));
    expect(audio.playCue('bell')).toBe(true);
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(audio.playCue('crash')).toBe(true);
    expect(oscillator.frequency.value).toBe(120);
  });

  it('exposes laser, bomb and explosion cue slots with synth fallback', async () => {
    const { SKYLINE_SOUND_SLOTS, createSkylineAudio } = await import("./skylineAudio.js");
    expect(SKYLINE_SOUND_SLOTS).toEqual(expect.arrayContaining(['laser', 'bomb', 'explosion']));
    const oscillator = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
    const context = {
      state: 'running', destination: {}, currentTime: 0, resume: vi.fn(),
      createGain: vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn() })), createOscillator: vi.fn(() => oscillator),
    };
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; } });
    await audio.prime();
    expect(audio.playCue('laser')).toBe(true);
    expect(oscillator.frequency.value).toBe(1320);
    expect(audio.playCue('bomb')).toBe(true);
    expect(oscillator.frequency.value).toBe(330);
    expect(audio.playCue('explosion')).toBe(true);
    expect(oscillator.frequency.value).toBe(90);
  });
});
