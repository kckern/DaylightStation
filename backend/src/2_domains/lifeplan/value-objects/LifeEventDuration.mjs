const VALS = ['temporary', 'indefinite', 'permanent'];
export const LifeEventDuration = Object.freeze({
  TEMPORARY: 'temporary', INDEFINITE: 'indefinite', PERMANENT: 'permanent',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
