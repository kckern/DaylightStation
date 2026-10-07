const CUE_FREQUENCIES = Object.freeze({
  bell: 880,
  checkpoint: 660,
  collision: 120,
  restart: 440,
  finish: 1040,
});

export function createSkylineAudio({
  AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext || null,
} = {}) {
  let context = null;
  let master = null;
  let wind = null;
  let muted = false;

  const ensure = () => {
    if (context || !AudioContextCtor) return !!context;
    try {
      context = new AudioContextCtor();
      master = context.createGain();
      master.gain.value = 0.05;
      master.connect(context.destination);
      return true;
    } catch {
      context = null;
      master = null;
      return false;
    }
  };

  return {
    async prime() {
      if (!ensure()) return false;
      try {
        if (context.state === 'suspended') await context.resume();
        return true;
      } catch { return false; }
    },
    startWind() {
      if (!ensure() || wind) return !!wind;
      try {
        wind = context.createOscillator();
        wind.type = 'sine';
        wind.frequency.value = 72;
        wind.connect(master);
        wind.start();
        return true;
      } catch {
        wind = null;
        return false;
      }
    },
    playCue(cue) {
      if (muted || !ensure() || !CUE_FREQUENCIES[cue]) return false;
      try {
        const oscillator = context.createOscillator();
        oscillator.type = cue === 'collision' ? 'square' : 'sine';
        oscillator.frequency.value = CUE_FREQUENCIES[cue];
        oscillator.connect(master);
        oscillator.start(context.currentTime);
        oscillator.stop(context.currentTime + (cue === 'finish' ? 0.28 : 0.14));
        return true;
      } catch { return false; }
    },
    setMuted(nextMuted) {
      muted = !!nextMuted;
      if (ensure()) master.gain.value = muted ? 0 : 0.05;
    },
    stop() {
      if (!wind) return;
      try { wind.stop(); } catch { /* already stopped */ }
      try { wind.disconnect(); } catch { /* optional */ }
      wind = null;
    },
  };
}
