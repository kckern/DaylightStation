// pianoPlaybackRate.js
// Discrete playback-rate ladder for the piano video chrome. Separate from the
// shared Player ladder ([1,1.5,2]) so slow-practice tempos are available without
// changing Player behavior elsewhere. Pure + tiny so it's trivially testable.
export const PIANO_PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Next rate in the ladder; unknown/absent current resolves to the 1x slot. */
export function nextPianoRate(current) {
  const i = PIANO_PLAYBACK_RATES.indexOf(current);
  const base = i === -1 ? PIANO_PLAYBACK_RATES.indexOf(1) : i;
  return PIANO_PLAYBACK_RATES[(base + 1) % PIANO_PLAYBACK_RATES.length];
}
