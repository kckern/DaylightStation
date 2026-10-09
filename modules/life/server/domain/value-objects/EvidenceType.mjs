const VALS = ['confirmation', 'disconfirmation', 'spurious', 'untested'];
export const EvidenceType = Object.freeze({
  CONFIRMATION: 'confirmation', DISCONFIRMATION: 'disconfirmation', SPURIOUS: 'spurious', UNTESTED: 'untested',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
