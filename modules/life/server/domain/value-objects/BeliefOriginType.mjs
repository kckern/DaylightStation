const VALS = ['experience', 'observation', 'teaching', 'culture', 'reasoning', 'trauma'];
export const BeliefOriginType = Object.freeze({
  EXPERIENCE: 'experience', OBSERVATION: 'observation', TEACHING: 'teaching',
  CULTURE: 'culture', REASONING: 'reasoning', TRAUMA: 'trauma',
  values() { return VALS; }, isValid(v) { return VALS.includes(v); },
});
