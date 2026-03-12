const VALS = ['distant', 'approaching', 'imminent'];
export const NightmareProximity = Object.freeze({
  DISTANT: 'distant', APPROACHING: 'approaching', IMMINENT: 'imminent',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
