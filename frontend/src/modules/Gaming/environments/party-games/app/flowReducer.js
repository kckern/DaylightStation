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

function selectSet(state, set) {
  return {
    ...state,
    phase: set.setup === 'none' ? 'playing' : 'team-setup',
    game: set.game,
    setId: set.setId,
    definitionId: set.definitionId,
    presenterId: set.presenter_id,
    setupProfile: set.setupProfile || { kind: set.setup || 'none' },
  };
}

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      const requestedSet = action.requestedGame
        ? action.sets.find((set) => set.valid && set.game === action.requestedGame)
        : null;
      if (requestedSet) return selectSet(next, requestedSet);
      return { ...next, phase: 'set-picker' };
    }
    case 'BOOT_FAILED':
      return { ...state, error: action.error };
    case 'PICK_SET':
      return selectSet(state, {
        ...action,
        presenter_id: action.presenterId,
      });
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
