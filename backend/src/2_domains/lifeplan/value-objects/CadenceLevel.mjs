const VALS = ['unit', 'cycle', 'phase', 'season', 'era'];
export const CadenceLevel = Object.freeze({
  UNIT: 'unit', CYCLE: 'cycle', PHASE: 'phase', SEASON: 'season', ERA: 'era',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
