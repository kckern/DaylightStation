import { describe, it, expect, vi, beforeEach } from 'vitest';
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
