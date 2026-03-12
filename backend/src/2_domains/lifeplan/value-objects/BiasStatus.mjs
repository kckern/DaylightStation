const VALS = ['acknowledged', 'dismissed', 'unexamined'];
export const BiasStatus = Object.freeze({
  ACKNOWLEDGED: 'acknowledged', DISMISSED: 'dismissed', UNEXAMINED: 'unexamined',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
