// click.js — a tiny WebAudio metronome blip. Import-safe (no AudioContext at
// module load; created lazily on first playClick). No-ops where WebAudio is
// unavailable (SSR / jsdom test env), so importers never crash.

let ctx = null;

function audioContext() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

export { audioContext };

/** Schedule the standard ~1kHz/40ms blip at an exact AudioContext time. */
export function scheduleBlipAt(ac, t) {
  try {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = 'square';
    osc.frequency.value = 1000;
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
    osc.connect(gain).connect(ac.destination);
    osc.start(t);
    osc.stop(t + 0.045);
  } catch { /* audio device gone — ignore */ }
}

/** Emit a short ~1kHz tick with a ~40ms decay envelope. Silent no-op if no WebAudio. */
export function playClick() {
  const ac = audioContext();
  if (!ac) return;
  if (ac.state === 'suspended') ac.resume();
  scheduleBlipAt(ac, ac.currentTime);
}

export default playClick;
