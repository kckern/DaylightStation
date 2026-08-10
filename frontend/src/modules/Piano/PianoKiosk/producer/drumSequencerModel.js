import { PPQ } from './useLoopCapture.js';
import { mintTakeId } from './producerIdentity.js';

export const DRUM_ROWS = Object.freeze([
  { label: 'Kick', gm: 36 },
  { label: 'Snare', gm: 38 },
  { label: 'Hi-Hat', gm: 42 },
  { label: 'Open Hat', gm: 46 },
  { label: 'Clap', gm: 39 },
  { label: 'Ride', gm: 51 },
]);

const STEPS_PER_BAR = 16;
const SIXTEENTH = PPQ / 4;
const PRESETS = Object.freeze({
  rock: { 36: [0, 8], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12, 14] },
  house: { 36: [0, 4, 8, 12], 39: [4, 12], 42: [2, 6, 10, 14] },
  funk: { 36: [0, 3, 7, 10], 38: [4, 12], 42: [0, 2, 4, 6, 8, 10, 12], 46: [14] },
});

/** Repeat a useful one-bar foundation through the chosen loop length. The last
 * rock/funk bar gets a tiny pickup so presets feel like phrases, not copy/paste. */
export function drumPreset(name, bars) {
  const pattern = PRESETS[name];
  const active = new Set();
  if (!pattern) return active;
  for (let bar = 0; bar < bars; bar += 1) {
    for (const [gm, localSteps] of Object.entries(pattern)) {
      for (const step of localSteps) active.add(`${gm}:${bar * STEPS_PER_BAR + step}`);
    }
  }
  if (bars > 1 && (name === 'rock' || name === 'funk')) {
    const end = (bars - 1) * STEPS_PER_BAR;
    active.add(`38:${end + 14}`);
    active.add(`38:${end + 15}`);
  }
  return active;
}

function hitVelocity(gm, step) {
  if (gm === 36) return step % 4 === 0 ? 116 : 102;
  if (gm === 38 || gm === 39) return step % 8 === 4 ? 112 : 98;
  if (gm === 42) return step % 4 === 0 ? 88 : 74;
  return 92;
}

export function drumPatternToTake(active, bars, { preset = null } = {}) {
  const notes = [];
  for (const key of active) {
    const [gm, step] = key.split(':').map(Number);
    notes.push({
      ticks: step * SIXTEENTH,
      durationTicks: SIXTEENTH,
      midi: gm,
      velocity: hitVelocity(gm, step),
    });
  }
  notes.sort((a, b) => a.ticks - b.ticks || a.midi - b.midi);
  return {
    takeId: mintTakeId('drum'),
    notes,
    ppq: PPQ,
    lengthBars: bars,
    kind: 'groove',
    drumMode: true,
    timeline: null,
    builder: { kind: 'drums', version: 1, preset, stepsPerBar: STEPS_PER_BAR },
  };
}
