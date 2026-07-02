import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createGmSynth, DRUM_CHANNEL, DRUM_NOTES } from './gmSynth.js';

// ── logging mock ────────────────────────────────────────────────────────────
const logCalls = vi.hoisted(() => ({ debug: [], info: [], warn: [], error: [], sampled: [] }));
vi.mock('../../../../lib/logging/Logger.js', () => ({
  default: () => ({
    child: () => ({
      debug: (...a) => logCalls.debug.push(a),
      info: (...a) => logCalls.info.push(a),
      warn: (...a) => logCalls.warn.push(a),
      error: (...a) => logCalls.error.push(a),
      sampled: (...a) => logCalls.sampled.push(a),
    }),
  }),
}));

// ── mocks: AudioContext / WebAudioFontPlayer / fetch ────────────────────────
// Melodic preset key for program p, mirroring webaudiofont's `PPPV_Font_sf2_file`
// naming (first 3 chars parse to the GM program number).
const keyFor = (program) => `${String(program).padStart(3, '0')}0_Mock_sf2_file`;
// Drum preset key for pitch nn, mirroring `NN_V_Font_sf2` (first 2 chars = pitch;
// the file on disk is prefixed `128`).
const drumKeyFor = (pitch) => `${pitch}_0_Mock_sf2`;

function makeMockAudioContext() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: { id: 'destination' },
    resume: vi.fn(() => { ctx.state = 'running'; return Promise.resolve(); }),
    createGain: vi.fn(() => ({
      gain: { value: 1 },
      connect: vi.fn(),
      disconnect: vi.fn(),
    })),
  };
  return ctx;
}

function makeMockPlayer() {
  const player = {
    loader: {
      findInstrument: vi.fn((program) => program),
      instrumentInfo: vi.fn((n) => ({
        variable: `_tone_${keyFor(n)}`,
        url: `https://cdn.example/sound/${keyFor(n)}.js`,
      })),
      findDrum: vi.fn((nn) => nn),
      drumInfo: vi.fn((n) => ({
        variable: `_drum_${drumKeyFor(n)}`,
        url: `https://cdn.example/sound/128${drumKeyFor(n)}.js`,
        pitch: n,
      })),
    },
    // Real adjustPreset decodes zone payloads into AudioBuffers (async via
    // decodeAudioData); the mock marks them decoded synchronously.
    adjustPreset: vi.fn((ctx, preset) => { preset.zones.forEach((z) => { z.buffer = {}; }); }),
    queueWaveTable: vi.fn(() => ({ cancel: vi.fn() })),
    cancelQueue: vi.fn(),
  };
  return player;
}

// Serves preset JS text the way surikov's files look: a top-level `var` holding
// the preset object. `__mock` tags the preset so tests can assert which preset
// reached queueWaveTable.
function makeMockFetch() {
  return vi.fn(async (url) => {
    const base = url.split('/').pop().replace(/\.js$/, '');
    const variable = base.startsWith('128') ? `_drum_${base.slice(3)}` : `_tone_${base}`;
    return {
      ok: true,
      status: 200,
      text: async () => `var ${variable} = { zones: [ {} ], __mock: '${variable}' };`,
    };
  });
}

function makeSynth(overrides = {}) {
  const audioContext = overrides.audioContext || makeMockAudioContext();
  const player = overrides.player || makeMockPlayer();
  const fetchImpl = overrides.fetchImpl || makeMockFetch();
  const synth = createGmSynth({
    audioContext,
    playerFactory: () => player,
    fetchImpl,
    ...overrides.options,
  });
  return { synth, audioContext, player, fetchImpl };
}

const qwtCalls = (player) => player.queueWaveTable.mock.calls;
// queueWaveTable(audioContext, target, preset, when, pitch, duration, volume, slides)
const QWT = { target: 1, preset: 2, pitch: 4, duration: 5, volume: 6 };

beforeEach(() => {
  for (const k of Object.keys(logCalls)) logCalls[k].length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createGmSynth', () => {
  it('exposes the drum channel convention: 0-indexed channel 9 (MIDI channel 10)', () => {
    expect(DRUM_CHANNEL).toBe(9);
    expect(DRUM_NOTES).toContain(36);
    expect(DRUM_NOTES).toContain(51);
  });

  describe('program-per-channel assignment', () => {
    it('routes each channel to its assigned program preset', async () => {
      const { synth, player } = makeSynth();
      synth.setChannelProgram(0, 0);
      synth.setChannelProgram(1, 33);
      await synth.load(0);
      await synth.load(33);

      synth.noteOn(0, 60, 100);
      synth.noteOn(1, 36, 100);

      const calls = qwtCalls(player);
      expect(calls).toHaveLength(2);
      expect(calls[0][QWT.preset].__mock).toBe(`_tone_${keyFor(0)}`);
      expect(calls[1][QWT.preset].__mock).toBe(`_tone_${keyFor(33)}`);
      expect(calls[0][QWT.pitch]).toBe(60);
      expect(calls[1][QWT.pitch]).toBe(36);
    });

    it('defaults an unassigned channel to program 0', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(3, 64, 90);
      expect(qwtCalls(player)[0][QWT.preset].__mock).toBe(`_tone_${keyFor(0)}`);
    });

    it('reassigning a channel program switches the preset used', async () => {
      const { synth, player } = makeSynth();
      synth.setChannelProgram(2, 24);
      await synth.load(24);
      synth.noteOn(2, 60, 100);
      synth.setChannelProgram(2, 48);
      await synth.load(48);
      synth.noteOn(2, 60, 100);
      const calls = qwtCalls(player);
      expect(calls[0][QWT.preset].__mock).toBe(`_tone_${keyFor(24)}`);
      expect(calls[1][QWT.preset].__mock).toBe(`_tone_${keyFor(48)}`);
    });

    it('setChannelProgram triggers a lazy load (fire-and-forget)', async () => {
      const { synth, fetchImpl } = makeSynth();
      synth.setChannelProgram(0, 4);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      expect(fetchImpl.mock.calls[0][0]).toContain(keyFor(4));
    });
  });

  describe('gain', () => {
    it('routes each channel through its own GainNode into the master', async () => {
      const { synth, player, audioContext } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      synth.noteOn(1, 62, 100);
      const calls = qwtCalls(player);
      expect(calls[0][QWT.target]).not.toBe(calls[1][QWT.target]);
      // master + 2 channels
      expect(audioContext.createGain.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('setChannelGain sets the channel GainNode value, clamped to 0..1', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.setChannelGain(0, 0.5);
      synth.noteOn(0, 60, 127);
      expect(qwtCalls(player)[0][QWT.target].gain.value).toBe(0.5);
      synth.setChannelGain(0, 4);
      expect(qwtCalls(player)[0][QWT.target].gain.value).toBe(1);
      synth.setChannelGain(0, -1);
      expect(qwtCalls(player)[0][QWT.target].gain.value).toBe(0);
    });

    it('scales queueWaveTable volume by velocity/127', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 127);
      synth.noteOn(0, 62, 64);
      const calls = qwtCalls(player);
      expect(calls[0][QWT.volume]).toBeCloseTo(1);
      expect(calls[1][QWT.volume]).toBeCloseTo(64 / 127);
    });

    it('clamps velocity to 1..127', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 999);
      expect(qwtCalls(player)[0][QWT.volume]).toBeCloseTo(1);
    });

    it('queues melodic notes for the 30s sustain window, drums as 3s one-shots', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      await synth.loadDrums();
      synth.noteOn(0, 60, 100);
      synth.noteOn(9, 36, 100);
      const calls = qwtCalls(player);
      expect(calls[0][QWT.duration]).toBe(30);
      expect(calls[1][QWT.duration]).toBe(3);
    });
  });

  describe('drum channel (0-indexed 9 = MIDI ch10)', () => {
    it('loadDrums fetches one file per drum pitch', async () => {
      const { synth, fetchImpl } = makeSynth();
      await synth.loadDrums();
      expect(fetchImpl).toHaveBeenCalledTimes(DRUM_NOTES.length);
    });

    it('routes channel 9 notes to the per-pitch drum presets', async () => {
      const { synth, player } = makeSynth();
      await synth.loadDrums();
      synth.noteOn(9, 36, 110);
      synth.noteOn(9, 42, 80);
      const calls = qwtCalls(player);
      expect(calls[0][QWT.preset].__mock).toBe(`_drum_${drumKeyFor(36)}`);
      expect(calls[1][QWT.preset].__mock).toBe(`_drum_${drumKeyFor(42)}`);
      expect(calls[0][QWT.pitch]).toBe(36);
    });

    it('does not use melodic presets for channel 9', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0); // melodic loaded, drums NOT loaded
      synth.noteOn(9, 36, 100);
      expect(player.queueWaveTable).not.toHaveBeenCalled();
      expect(logCalls.sampled.length).toBeGreaterThan(0);
    });

    it('drops (and logs) a drum pitch outside the loaded set', async () => {
      const { synth, player } = makeSynth();
      await synth.loadDrums();
      expect(() => synth.noteOn(9, 77, 100)).not.toThrow();
      expect(player.queueWaveTable).not.toHaveBeenCalled();
      expect(logCalls.sampled.length).toBeGreaterThan(0);
    });

    it('concurrent loadDrums calls share one underlying load', async () => {
      const { synth, fetchImpl } = makeSynth();
      await Promise.all([synth.loadDrums(), synth.loadDrums()]);
      expect(fetchImpl).toHaveBeenCalledTimes(DRUM_NOTES.length);
    });
  });

  describe('unloaded program handling', () => {
    it('drops the note without throwing and logs (sampled)', () => {
      const { synth, player } = makeSynth();
      expect(() => synth.noteOn(0, 60, 100)).not.toThrow();
      expect(player.queueWaveTable).not.toHaveBeenCalled();
      expect(logCalls.sampled.length).toBeGreaterThan(0);
    });
  });

  describe('load()', () => {
    it('dedupes concurrent loads of the same program to one fetch', async () => {
      const { synth, fetchImpl } = makeSynth();
      await Promise.all([synth.load(0), synth.load(0)]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('is idempotent after resolution', async () => {
      const { synth, fetchImpl } = makeSynth();
      await synth.load(0);
      await synth.load(0);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it('fetches from the configured baseUrl, not the CDN', async () => {
      const { synth, fetchImpl } = makeSynth({ options: { baseUrl: '/webaudiofont' } });
      await synth.load(0);
      expect(fetchImpl.mock.calls[0][0]).toBe(`/webaudiofont/${keyFor(0)}.js`);
    });

    it('rejects on HTTP failure and logs a warning', async () => {
      const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, text: async () => '' }));
      const { synth } = makeSynth({ fetchImpl });
      await expect(synth.load(0)).rejects.toThrow();
      expect(logCalls.warn.length).toBeGreaterThan(0);
    });

    it('a failed load can be retried (in-flight entry cleared)', async () => {
      let fail = true;
      const good = makeMockFetch();
      const fetchImpl = vi.fn(async (url) => {
        if (fail) return { ok: false, status: 500, text: async () => '' };
        return good(url);
      });
      const { synth } = makeSynth({ fetchImpl });
      await expect(synth.load(0)).rejects.toThrow();
      fail = false;
      await expect(synth.load(0)).resolves.toBeUndefined();
    });

    it('setChannelProgram with a failing load does not produce an unhandled rejection', async () => {
      const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, text: async () => '' }));
      const { synth } = makeSynth({ fetchImpl });
      synth.setChannelProgram(0, 4);
      await vi.waitFor(() => expect(logCalls.warn.length).toBeGreaterThan(0));
      // note on the failed program just drops
      expect(() => synth.noteOn(0, 60, 100)).not.toThrow();
    });
  });

  describe('zone-buffer decode polling (async decodeAudioData path)', () => {
    // The real adjustPreset fills zone.buffer asynchronously (decodeAudioData
    // has no completion callback we can hook), so gmSynth polls. These tests
    // use an adjustPreset that does NOT fill buffers, exercising the interval.

    it('resolves once buffers appear after several polls', async () => {
      vi.useFakeTimers();
      const player = makeMockPlayer();
      player.adjustPreset = vi.fn(); // async decode still pending
      const { synth } = makeSynth({ player });
      let resolved = false;
      const p = synth.load(0);
      p.then(() => { resolved = true; });
      await vi.advanceTimersByTimeAsync(0); // flush fetch/text microtasks → poll armed
      expect(player.adjustPreset).toHaveBeenCalledTimes(1);
      const preset = player.adjustPreset.mock.calls[0][1];
      await vi.advanceTimersByTimeAsync(120); // ~2 polls, still not decoded
      expect(resolved).toBe(false);
      preset.zones.forEach((z) => { z.buffer = {}; }); // decode completes
      await vi.advanceTimersByTimeAsync(60); // next poll sees the buffers
      expect(resolved).toBe(true);
      await p;
      expect(vi.getTimerCount()).toBe(0); // interval cleared
    });

    it('rejects at the decode timeout and clears the poll interval', async () => {
      vi.useFakeTimers();
      const player = makeMockPlayer();
      player.adjustPreset = vi.fn(); // buffers never fill
      const { synth } = makeSynth({ player });
      let err = null;
      const p = synth.load(0).catch((e) => { err = e; });
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(15100); // past the 15s decode timeout
      await p;
      expect(err).toBeTruthy();
      expect(err.message).toMatch(/timed out/);
      expect(vi.getTimerCount()).toBe(0); // interval cleared on rejection
      expect(logCalls.warn.length).toBeGreaterThan(0); // load-failed logged
    });

    it('dispose() during decode aborts the poll and clears the interval', async () => {
      vi.useFakeTimers();
      const player = makeMockPlayer();
      player.adjustPreset = vi.fn();
      const { synth } = makeSynth({ player });
      let err = null;
      const p = synth.load(0).catch((e) => { err = e; });
      await vi.advanceTimersByTimeAsync(0); // poll armed
      synth.dispose();
      await vi.advanceTimersByTimeAsync(100); // next poll notices disposal
      await p;
      expect(err).toBeTruthy();
      expect(err.message).toMatch(/disposed/);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('envelope pooling / pitch guard', () => {
    // webaudiofont pools envelope objects: once a voice's queued duration
    // expires, findEnvelope hands the SAME object to a later queueWaveTable
    // call. A stale activeVoices entry must never cancel the reused voice.

    it('noteOff does not cancel a pooled envelope reused under a stale key', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      const shared = { cancel: vi.fn() };
      player.queueWaveTable.mockReturnValue(shared); // same object every call
      synth.noteOn(0, 60, 100); // stamps shared.pitch = 60, key '0:60'
      // '0:60' expires naturally (>30s); the library reuses `shared` for the
      // next voice — our stamp mirrors queueWaveTable's own pitch re-stamp.
      synth.noteOn(0, 64, 100); // shared.pitch = 64, key '0:64'
      synth.noteOff(0, 60); // stale key — must NOT kill the note-64 voice
      expect(shared.cancel).not.toHaveBeenCalled();
      synth.noteOff(0, 64); // live key — releases normally
      expect(shared.cancel).toHaveBeenCalledTimes(1);
    });

    it('allNotesOff(channel) skips pooled envelopes reused for another pitch', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      const reused = { cancel: vi.fn() };
      const live = { cancel: vi.fn() };
      player.queueWaveTable.mockReturnValueOnce(reused).mockReturnValueOnce(live);
      synth.noteOn(0, 60, 100); // reused.pitch = 60, key '0:60'
      // Simulate the pool handing `reused` to a voice we don't track (e.g.
      // another channel's note): the library re-stamps its pitch.
      reused.pitch = 72;
      synth.noteOn(0, 62, 100); // live.pitch = 62, key '0:62'
      synth.allNotesOff(0);
      expect(reused.cancel).not.toHaveBeenCalled();
      expect(live.cancel).toHaveBeenCalledTimes(1);
    });

    it('retriggering a channel+note releases the prior voice', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      const e1 = { cancel: vi.fn() };
      const e2 = { cancel: vi.fn() };
      player.queueWaveTable.mockReturnValueOnce(e1).mockReturnValueOnce(e2);
      synth.noteOn(0, 60, 100);
      synth.noteOn(0, 60, 100); // retrigger
      expect(e1.cancel).toHaveBeenCalledTimes(1);
      expect(e2.cancel).not.toHaveBeenCalled();
    });

    it('retrigger does not cancel a pooled envelope now voicing another pitch', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      const e1 = { cancel: vi.fn() };
      const e2 = { cancel: vi.fn() };
      player.queueWaveTable.mockReturnValueOnce(e1).mockReturnValueOnce(e2);
      synth.noteOn(0, 60, 100); // e1.pitch = 60, key '0:60'
      e1.pitch = 71; // pool reused e1 for an untracked voice
      synth.noteOn(0, 60, 100); // retrigger on the stale key
      expect(e1.cancel).not.toHaveBeenCalled();
    });
  });

  describe('noteOff / allNotesOff', () => {
    it('noteOff cancels the envelope for that channel+note', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      const env = player.queueWaveTable.mock.results[0].value;
      synth.noteOff(0, 60);
      expect(env.cancel).toHaveBeenCalledTimes(1);
      // second noteOff is a no-op
      synth.noteOff(0, 60);
      expect(env.cancel).toHaveBeenCalledTimes(1);
    });

    it('noteOff for an unknown note does not throw', () => {
      const { synth } = makeSynth();
      expect(() => synth.noteOff(0, 60)).not.toThrow();
    });

    it('allNotesOff(channel) cancels only that channel', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      synth.noteOn(1, 62, 100);
      const env0 = player.queueWaveTable.mock.results[0].value;
      const env1 = player.queueWaveTable.mock.results[1].value;
      synth.allNotesOff(0);
      expect(env0.cancel).toHaveBeenCalled();
      expect(env1.cancel).not.toHaveBeenCalled();
      expect(player.cancelQueue).not.toHaveBeenCalled();
    });

    it('allNotesOff() with no channel is a full panic via cancelQueue', async () => {
      const { synth, player, audioContext } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      synth.allNotesOff();
      expect(player.cancelQueue).toHaveBeenCalledWith(audioContext);
    });
  });

  describe('suspended AudioContext', () => {
    it('auto-resumes on noteOn when suspended', async () => {
      const audioContext = makeMockAudioContext();
      audioContext.state = 'suspended';
      const { synth } = makeSynth({ audioContext });
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      expect(audioContext.resume).toHaveBeenCalled();
    });

    it('exposes resume()', async () => {
      const audioContext = makeMockAudioContext();
      audioContext.state = 'suspended';
      const { synth } = makeSynth({ audioContext });
      await synth.resume();
      expect(audioContext.resume).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('panics, disconnects nodes, and turns the synth inert', async () => {
      const { synth, player } = makeSynth();
      await synth.load(0);
      synth.noteOn(0, 60, 100);
      const target = qwtCalls(player)[0][QWT.target];
      synth.dispose();
      expect(player.cancelQueue).toHaveBeenCalled();
      expect(target.disconnect).toHaveBeenCalled();
      // inert afterward: no throw, no new voices
      expect(() => synth.noteOn(0, 60, 100)).not.toThrow();
      expect(qwtCalls(player)).toHaveLength(1);
      await expect(synth.load(4)).resolves.toBeUndefined();
    });
  });
});
