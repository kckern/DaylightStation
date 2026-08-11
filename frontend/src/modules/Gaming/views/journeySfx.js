import { getChildLogger } from '../../../lib/logging/singleton.js';

let audioContext = null;
const logger = getChildLogger({ component: 'pokemon-journey-sfx' });

function context() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) return null;
  audioContext ||= new AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume().catch((error) => {
    logger.warn('pokemon-journey.sfx-resume-blocked', { error: error.message });
  });
  return audioContext;
}

export function playJourneySfx(kind) {
  const ctx = context();
  if (!ctx) return false;
  const patterns = {
    direct: [[523, 0], [659, 0.07], [784, 0.14]],
    partial: [[392, 0], [494, 0.1]],
    miss: [[180, 0], [145, 0.12]],
    badge: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.32]],
    defeat: [[330, 0], [262, 0.14], [196, 0.28]],
  };
  const notes = patterns[kind];
  if (!notes) return false;
  try {
    for (const [frequency, delay] of notes) {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + delay;
      oscillator.type = kind === 'miss' ? 'square' : 'triangle';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.08, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.14);
    }
    return true;
  } catch (error) {
    logger.warn('pokemon-journey.sfx-failed', { kind, error: error.message });
    return false;
  }
}

export default playJourneySfx;
