export const BELIEF_TRANSITIONS = {
  hypothesized: ['testing', 'dormant'],
  testing: ['confirmed', 'uncertain', 'refuted'],
  confirmed: ['testing', 'questioning'],
  uncertain: ['testing', 'questioning'],
  refuted: ['revised', 'abandoned'],
  dormant: ['testing', 'abandoned'],
  questioning: ['testing', 'revised', 'abandoned'],
  revised: ['testing'],
  abandoned: [],
};

export const BeliefState = Object.freeze({
  HYPOTHESIZED: 'hypothesized',
  TESTING: 'testing',
  CONFIRMED: 'confirmed',
  UNCERTAIN: 'uncertain',
  REFUTED: 'refuted',
  DORMANT: 'dormant',
  QUESTIONING: 'questioning',
  REVISED: 'revised',
  ABANDONED: 'abandoned',
  values() { return Object.keys(BELIEF_TRANSITIONS); },
  isValid(v) { return v in BELIEF_TRANSITIONS; },
  canTransition(from, to) { return BELIEF_TRANSITIONS[from]?.includes(to) ?? false; },
  isTerminal(state) { return (BELIEF_TRANSITIONS[state] || []).length === 0; },
  getValidTransitions(from) { return BELIEF_TRANSITIONS[from] || []; },
});
