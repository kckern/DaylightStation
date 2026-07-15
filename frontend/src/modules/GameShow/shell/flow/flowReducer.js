// Outer shell flow: loading → (resume-gate) → set-picker → team-setup →
// buzzer-bind → playing → results. Game-agnostic — knows nothing about
// what happens inside 'playing' (the mounted game owns that).

export const initialFlowState = {
  phase: 'loading',
  config: null,
  sets: [],
  game: 'jeopardy',
  setId: null,
  teams: [],
  buzzerBindings: null,
  sessionId: null,
  resumeSession: null,
  error: null,
};

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      if (action.activeSession) return { ...next, phase: 'resume-gate', resumeSession: action.activeSession };
      return { ...next, phase: 'set-picker' };
    }
    case 'BOOT_FAILED':
      return { ...state, error: action.error };
    case 'RESUME_ACCEPT': {
      const s = state.resumeSession;
      if (!s) return state;
      return { ...state, phase: 'playing', sessionId: s.id, game: s.game, setId: s.setId, teams: s.teams || [], resumeSession: s };
    }
    case 'RESUME_DISCARD':
      return { ...state, phase: 'set-picker', resumeSession: null, sessionId: null };
    case 'PICK_SET':
      return { ...state, phase: 'team-setup', setId: action.setId };
    case 'TEAMS_CONFIRMED':
      return { ...state, phase: 'buzzer-bind', teams: action.teams };
    case 'BIND_DONE':
      return { ...state, phase: 'playing', buzzerBindings: action.bindings || null };
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };
    case 'GAME_FINISHED':
      return { ...state, phase: 'results' };
    case 'PLAY_AGAIN':
      return { ...state, phase: 'set-picker', setId: null, sessionId: null, resumeSession: null };
    default:
      return state;
  }
}
