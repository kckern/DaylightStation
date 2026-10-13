const VALS = ['family', 'career', 'location', 'education', 'health', 'financial'];
export const LifeEventType = Object.freeze({
  FAMILY: 'family', CAREER: 'career', LOCATION: 'location',
  EDUCATION: 'education', HEALTH: 'health', FINANCIAL: 'financial',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
