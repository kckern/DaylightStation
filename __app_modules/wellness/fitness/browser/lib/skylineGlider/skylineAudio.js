// Skyline Glider sound. A zone may name a file for every cue and loop; a cue
// with no decodable file (missing, empty placeholder, bad format) falls back to
// a synthesized tone, so populating a sound is a file drop with no code change.

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
});
const LOOPS = Object.freeze({ wind: 0.35, music: 0.5 });
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

  const ensure = () => {
    if (context || !AudioContextCtor) return !!context;
    try {
      context = new AudioContextCtor();
      master = context.createGain();
      master.gain.value = SYNTH_GAIN;
      master.connect(context.destination);
      samples = context.createGain();
      samples.gain.value = SAMPLE_GAIN;
      samples.connect(context.destination);
      return true;
    } catch {
      context = null;
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
      if (muted || !ensure() || context.state !== 'running' || !CUE_FREQUENCIES[cue]) return false;
      try {
        if (buffers.has(cue)) {
          playBuffer(buffers.get(cue));
          return true;
        }
        const oscillator = context.createOscillator();
        oscillator.type = cue === 'crash' || cue === 'breakable' ? 'square' : 'sine';
        oscillator.frequency.value = CUE_FREQUENCIES[cue];
        oscillator.connect(master);
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + (cue === 'finish' || cue === 'crash' ? 0.28 : 0.14));
        return true;
      } catch { return false; }
    },
    setMuted(nextMuted) {
      muted = !!nextMuted;
      if (!ensure()) return;
      master.gain.value = muted ? 0 : SYNTH_GAIN;
      samples.gain.value = muted ? 0 : SAMPLE_GAIN;
    },
    stop() {
      if (drone) stopNode(drone);
      drone = null;
      for (const node of loops.values()) stopNode(node);
      loops.clear();
    },
  };
}
