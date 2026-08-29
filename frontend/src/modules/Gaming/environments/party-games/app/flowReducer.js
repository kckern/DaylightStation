// Outer shell flow: loading → set-picker → team-setup → buzzer-bind → playing
// → results. Game-agnostic — knows nothing about
// what happens inside 'playing' (the mounted game owns that).

export const initialFlowState = {
  phase: 'loading',
  config: null,
  sets: [],
  game: null,
  setId: null,
  definitionId: null,
  setupProfile: { kind: 'none' },
  presenterId: null,
  hostMode: 'human',
  teams: [],
  buzzerBindings: null,
  sessionId: null,
  error: null,
};

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      return { ...next, phase: 'set-picker' };
    }
    case 'BOOT_FAILED':
      return { ...state, error: action.error };
    case 'PICK_SET':
      return { ...state, phase: action.setup === 'none' ? 'playing' : 'team-setup', game: action.game, setId: action.setId, definitionId: action.definitionId, presenterId: action.presenterId, setupProfile: action.setupProfile || { kind: action.setup || 'none' } };
    case 'TEAMS_CONFIRMED':
      return { ...state, phase: 'buzzer-bind', teams: action.teams };
    case 'SET_HOST_MODE':
      return { ...state, hostMode: action.hostMode };
    case 'BIND_DONE':
      return { ...state, phase: 'playing', buzzerBindings: action.bindings || null };
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };
    case 'GAME_FINISHED':
      return { ...state, phase: 'results' };
    case 'PLAY_AGAIN':
      return { ...state, phase: 'set-picker', game: null, setId: null, definitionId: null, presenterId: null, setupProfile: { kind: 'none' }, sessionId: null };
    default:
      return state;
  }
}
