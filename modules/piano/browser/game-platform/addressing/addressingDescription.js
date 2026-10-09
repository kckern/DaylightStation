// addressingDescription.js — human-readable summary of a resolved addressing
// rung, split out of AddressingSettings.jsx so Fast Refresh can hot-reload
// the settings component on its own.

/** What the chosen rung actually does, in one line, so the step is not a guess. */
export function describeAddressing(resolved) {
  const vocabulary = { staff: 'Notes on a staff', chords: 'Chords', names: 'Key names' }[resolved.vocabulary];
  const order = resolved.x.order === 'shuffled' ? 'shuffled'
    : resolved.x.order === 'reverse' ? 'reversed' : 'in order';
  const cadence = {
    never: 'the map stays put', each_game: 're-dealt each game', each_turn: 're-dealt every turn',
  }[resolved.shuffle];
  const inversion = resolved.vocabulary === 'chords' && resolved.inversions !== 'any'
    ? resolved.inversions === 'root' ? ', root in the bass' : ', slash chords'
    : '';
  return `${vocabulary}, ${order} — ${cadence}${inversion}.`;
}
