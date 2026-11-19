// passageChime.js — the short sound for a passage turning Silver or Gold, and the
// longer one for a whole piece. Synthesized through the player's own WebAudio
// context (the metronome click's), so there is no asset to load and nothing new
// to unlock. Best effort: a refused context costs the celebration nothing.
import { audioContext } from './click.js';

// Pitches in Hz. Silver is a rising fifth, Gold the same figure a third higher.
const FIGURES = Object.freeze({
  silver: [659.25, 987.77],
  gold: [783.99, 1174.66],
});
const PIECE = Object.freeze({
  silver: [523.25, 659.25, 783.99, 1046.5],
  gold: [659.25, 783.99, 987.77, 1318.51],
});

function tone(ac, frequency, at, seconds, gain) {
  const osc = ac.createOscillator();
  const envelope = ac.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(frequency, at);
  envelope.gain.setValueAtTime(0, at);
  envelope.gain.linearRampToValueAtTime(gain, at + 0.012);
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(envelope).connect(ac.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.02);
}

/** @returns {boolean} whether a sound was scheduled */
export function playPassageChime({ level = 'silver', piece = false } = {}) {
  try {
    const ac = audioContext();
    if (!ac) return false;
    if (ac.state === 'suspended') ac.resume?.();
    const notes = (piece ? PIECE : FIGURES)[level] ?? FIGURES.silver;
    const step = piece ? 0.13 : 0.11;
    notes.forEach((frequency, index) => tone(ac, frequency, ac.currentTime + index * step,
      piece && index === notes.length - 1 ? 0.9 : 0.32, 0.09));
    return true;
  } catch { return false; }
}

export default playPassageChime;
