const VALS = ['prerequisite', 'recommended', 'life_event', 'resource'];
export const DependencyType = Object.freeze({
  PREREQUISITE: 'prerequisite', RECOMMENDED: 'recommended', LIFE_EVENT: 'life_event', RESOURCE: 'resource',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
