const VALS = ['aligned', 'drifting', 'reconsidering'];
export const AlignmentState = Object.freeze({
  ALIGNED: 'aligned', DRIFTING: 'drifting', RECONSIDERING: 'reconsidering',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
