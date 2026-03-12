const VALS = ['unit_intention', 'unit_capture', 'cycle_retro', 'phase_review', 'season_review', 'era_review', 'emergency_retro'];
export const CeremonyType = Object.freeze({
  UNIT_INTENTION: 'unit_intention', UNIT_CAPTURE: 'unit_capture', CYCLE_RETRO: 'cycle_retro',
  PHASE_REVIEW: 'phase_review', SEASON_REVIEW: 'season_review', ERA_REVIEW: 'era_review',
  EMERGENCY_RETRO: 'emergency_retro',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
