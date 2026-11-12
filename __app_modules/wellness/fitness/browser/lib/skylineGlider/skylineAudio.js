// Skyline Glider sound. A zone may name a file for every cue and loop; a cue
// with no decodable file (missing, empty placeholder, bad format) falls back to
// a synthesized tone, so populating a sound is a file drop with no code change.
//
// Every voice (cue files, music, wind, synth tones, the drone) ends on ONE
// output gain = fitness master volume x mute. The level comes from the shared
// fitness volume store (usePersistentVolume fitness/global/video, the same
// level the sidebar volume buttons and the Cycle Game drive) via setVolume();
// the in-game sound toggle is setMuted(). Loops sit below cues (LOOPS gains).

const CUE_FREQUENCIES = Object.freeze({
  bell: 880,
  checkpoint: 660,
  breakable: 220,
  crash: 120,
  restart: 440,
  finish: 1040,
  laser: 1320,
  bomb: 330,
  explosion: 90,
  missile: 990,
  boost: 520,
  hit: 1560,
  target: 1180,
  hurt: 160,
  deny: 200,
});
// Loops play under the cues: music about -6 dB, wind about -12 dB below a cue.
const LOOPS = Object.freeze({ wind: 0.25, music: 0.5 });
const SYNTH_GAIN = 0.05;
const SAMPLE_GAIN = 0.8;

export const SKYLINE_SOUND_SLOTS = Object.freeze([...Object.keys(CUE_FREQUENCIES), ...Object.keys(LOOPS)]);

export function createSkylineAudio({
  AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext || null,
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  let context = null;
  let master = null;
  let samples = null;
  let drone = null;
  const loops = new Map();
  let buffers = new Map();
  let muted = false;
  let volume = 1;
  let output = null;

  const clampLevel = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1);
  const outputLevel = () => (muted ? 0 : volume);

  const ensure = () => {
    if (context || !AudioContextCtor) return !!context;
    try {
      context = new AudioContextCtor();
      output = context.createGain();
      output.gain.value = outputLevel();
      output.connect(context.destination);
      master = context.createGain();
      master.gain.value = SYNTH_GAIN;
      master.connect(output);
      samples = context.createGain();
      samples.gain.value = SAMPLE_GAIN;
      samples.connect(output);
      return true;
    } catch {
      context = null;
      output = null;
      master = null;
      samples = null;
      return false;
    }
  };

  const playBuffer = (buffer, { loop = false, volume = 1 } = {}) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    if (volume === 1) source.connect(samples);
    else {
      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(samples);
    }
    source.start(context.currentTime);
    return source;
  };

  const stopNode = (node) => {
    try { node.stop(); } catch { /* already stopped */ }
    try { node.disconnect(); } catch { /* optional */ }
  };

  return {
    async prime() {
      if (!ensure()) return false;
      try {
        if (context.state === 'suspended') await context.resume();
        return context.state === 'running';
      } catch { return false; }
    },
    /**
     * Fetch and decode a zone's sounds ({ slot: url }). Resolves to a report
     * the caller logs: which slots loaded and why each other one did not.
     */
    async loadSounds(sounds = {}) {
      const loaded = [];
      const missing = [];
      const next = new Map();
      if (!ensure()) {
        return { loaded, missing: Object.keys(sounds).map((slot) => ({ slot, reason: 'audio-unavailable' })) };
      }
      await Promise.all(Object.entries(sounds).map(async ([slot, url]) => {
        if (!SKYLINE_SOUND_SLOTS.includes(slot)) { missing.push({ slot, url, reason: 'unknown-slot' }); return; }
        try {
          const response = await fetchImpl(url);
          if (!response.ok) { missing.push({ slot, url, reason: `http-${response.status}` }); return; }
          const bytes = await response.arrayBuffer();
          if (!bytes.byteLength) { missing.push({ slot, url, reason: 'empty' }); return; }
          next.set(slot, await context.decodeAudioData(bytes));
          loaded.push(slot);
        } catch (error) {
          missing.push({ slot, url, reason: error?.name === 'EncodingError' ? 'undecodable' : (error?.message || 'error') });
        }
      }));
      buffers = next;
      return { loaded: loaded.sort(), missing };
    },
    startWind() {
      if (!ensure() || context.state !== 'running') return false;
      if (drone || loops.size) return true;
      try {
        for (const [slot, volume] of Object.entries(LOOPS)) {
          if (buffers.has(slot)) loops.set(slot, playBuffer(buffers.get(slot), { loop: true, volume }));
        }
        if (!loops.has('wind')) {
          drone = context.createOscillator();
          drone.type = 'sine';
          drone.frequency.value = 72;
          drone.connect(master);
          drone.start();
        }
        return true;
      } catch {
        drone = null;
        return false;
      }
    },
    playCue(cue) {
      if (muted || volume <= 0 || !ensure() || context.state !== 'running' || !CUE_FREQUENCIES[cue]) return false;
      try {
        if (buffers.has(cue)) {
          playBuffer(buffers.get(cue));
          return true;
        }
        const oscillator = context.createOscillator();
        oscillator.type = ['crash', 'breakable', 'hurt', 'deny'].includes(cue) ? 'square' : 'sine';
        oscillator.frequency.value = CUE_FREQUENCIES[cue];
        oscillator.connect(master);
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + (cue === 'finish' || cue === 'crash' ? 0.28 : cue === 'hit' || cue === 'deny' ? 0.06 : 0.14));
        return true;
      } catch { return false; }
    },
    setMuted(nextMuted) {
      muted = !!nextMuted;
      if (output) output.gain.value = outputLevel();
    },
    /** Fitness master volume, 0..1 (already 0 when the store is muted). */
    setVolume(level) {
      volume = clampLevel(level);
      if (output) output.gain.value = outputLevel();
    },
    getLevels() {
      return { volume, muted, output: outputLevel() };
    },
    stop() {
      if (drone) stopNode(drone);
      drone = null;
      for (const node of loops.values()) stopNode(node);
      loops.clear();
    },
  };
}
