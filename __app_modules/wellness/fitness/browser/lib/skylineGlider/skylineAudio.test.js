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

  // A tiny Web Audio graph: every node remembers what it feeds, so a test can
  // walk any voice to the destination and multiply the gains on the way.
  const graphContext = () => {
    const destination = { name: 'destination' };
    const node = (extra = {}) => {
      const n = { out: null, connect: vi.fn((to) => { n.out = to; }), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), ...extra };
      return n;
    };
    const created = { sources: [], oscillators: [] };
    const context = {
      state: 'running', destination, currentTime: 0, resume: vi.fn(),
      createGain: vi.fn(() => node({ gain: { value: 1 } })),
      createOscillator: vi.fn(() => { const o = node({ type: '', frequency: { value: 0 } }); created.oscillators.push(o); return o; }),
      createBufferSource: vi.fn(() => { const b = node({ buffer: null, loop: false }); created.sources.push(b); return b; }),
      decodeAudioData: vi.fn(async () => ({ duration: 1 })),
    };
    const levelOf = (voice) => {
      let level = 1;
      let at = voice.out;
      while (at && at !== destination) { level *= at.gain ? at.gain.value : 1; at = at.out; }
      return at === destination ? level : NaN;
    };
    return { context, created, levelOf };
  };
  const filesFetch = (slots) => vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));

  it('scales file cues, music, wind and synth tones by the one fitness master volume', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const { context, created, levelOf } = graphContext();
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; }, fetchImpl: filesFetch() });
    audio.setVolume(0.5); // applied before the context exists
    await audio.prime();
    await audio.loadSounds({ bell: '/bell.mp3', music: '/music.ogg', wind: '/wind.ogg' });
    audio.startWind();
    audio.playCue('bell');
    audio.playCue('crash'); // no file -> synth tone
    const [music, wind] = [created.sources.find((s) => s.loop && levelOf(s) > 0.15), created.sources.find((s) => s.loop && levelOf(s) <= 0.15)];
    const bell = created.sources.find((s) => !s.loop);
    const tone = created.oscillators[0];
    const before = [bell, music, wind, tone].map(levelOf);
    expect(before.every((v) => v > 0)).toBe(true);

    audio.setVolume(0.25);
    const after = [bell, music, wind, tone].map(levelOf);
    after.forEach((v, i) => expect(v).toBeCloseTo(before[i] / 2, 6));
  });

  it('keeps music and wind well below cues', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const { context, created, levelOf } = graphContext();
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; }, fetchImpl: filesFetch() });
    await audio.prime();
    await audio.loadSounds({ bell: '/bell.mp3', music: '/music.ogg', wind: '/wind.ogg' });
    audio.startWind();
    audio.playCue('bell');
    const cue = levelOf(created.sources.find((s) => !s.loop));
    const loops = created.sources.filter((s) => s.loop).map(levelOf);
    expect(loops).toHaveLength(2);
    loops.forEach((level) => expect(level).toBeLessThanOrEqual(cue / 2));
  });

  it('silences every voice -- loops included -- at volume 0 or on mute, and skips new cues', async () => {
    const { createSkylineAudio } = await import("./skylineAudio.js");
    const { context, created, levelOf } = graphContext();
    const audio = createSkylineAudio({ AudioContextCtor: function AudioContext() { return context; }, fetchImpl: filesFetch() });
    await audio.prime();
    await audio.loadSounds({ music: '/music.ogg' });
    audio.startWind(); // music file + synth drone
    const voices = [...created.sources, ...created.oscillators];
    expect(voices).toHaveLength(2);
    audio.setVolume(0);
    voices.forEach((v) => expect(levelOf(v)).toBe(0));
    expect(audio.playCue('bell')).toBe(false);
    audio.setVolume(0.8);
    voices.forEach((v) => expect(levelOf(v)).toBeGreaterThan(0));
    audio.setMuted(true);
    voices.forEach((v) => expect(levelOf(v)).toBe(0));
    expect(audio.getLevels()).toEqual({ volume: 0.8, muted: true, output: 0 });
  });
});

