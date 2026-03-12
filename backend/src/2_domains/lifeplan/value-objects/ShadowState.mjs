const VALS = ['dormant', 'emerging', 'active'];
export const ShadowState = Object.freeze({
  DORMANT: 'dormant', EMERGING: 'emerging', ACTIVE: 'active',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
