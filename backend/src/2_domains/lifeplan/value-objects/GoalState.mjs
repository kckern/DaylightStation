export const GOAL_TRANSITIONS = {
  dream: ['considered', 'abandoned', 'invalidated'],
  considered: ['ready', 'dream', 'abandoned', 'invalidated'],
  ready: ['committed', 'considered', 'abandoned', 'invalidated'],
  committed: ['achieved', 'failed', 'paused', 'abandoned', 'invalidated'],
  paused: ['committed', 'abandoned', 'invalidated'],
  failed: ['considered', 'invalidated'],
  achieved: [],
  abandoned: [],
  invalidated: [],
};

const TERMINAL = ['achieved', 'abandoned', 'invalidated'];

export const GoalState = Object.freeze({
  DREAM: 'dream',
  CONSIDERED: 'considered',
  READY: 'ready',
  COMMITTED: 'committed',
  PAUSED: 'paused',
  ACHIEVED: 'achieved',
  FAILED: 'failed',
  ABANDONED: 'abandoned',
  INVALIDATED: 'invalidated',
  values() { return Object.keys(GOAL_TRANSITIONS); },
  isValid(v) { return v in GOAL_TRANSITIONS; },
  canTransition(from, to) { return GOAL_TRANSITIONS[from]?.includes(to) ?? false; },
  isTerminal(state) { return TERMINAL.includes(state); },
  getValidTransitions(from) { return GOAL_TRANSITIONS[from] || []; },
});
