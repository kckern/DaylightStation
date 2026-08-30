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
  theme: null,
  inputProfile: null,
  lifecycleCapabilities: [],
  presenterId: null,
  hostMode: 'human',
  seats: [],
  buzzerBindings: null,
  sessionId: null,
  result: null,
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
    theme: set.theme || null,
    inputProfile: set.input_profile || set.inputProfile || null,
    lifecycleCapabilities: set.lifecycle_capabilities || set.lifecycleCapabilities || [],
    result: null,
  };
}

function attachSession(state, sets, session) {
  const diagnosticDefinitionId = session?.diagnostic?.definition_id;
  const experienceId = session?.header?.experience?.id;
  const mounted = sets.find((set) => set.valid && (
    diagnosticDefinitionId ? set.definitionId === diagnosticDefinitionId : set.game === experienceId
  ));
  if (!mounted) {
    const identity = diagnosticDefinitionId || experienceId || 'missing';
    return { ...state, phase: 'set-picker', error: `Session experience is not mounted: ${identity}` };
  }
  return {
    ...selectSet(state, mounted),
    phase: session?.header?.status === 'complete' && session.result ? 'results' : 'playing',
    seats: session.header?.seats || [],
    sessionId: session.header?.session_id || null,
    hostMode: session.state?.host?.mode || state.hostMode,
    result: session.result || null,
    error: null,
  };
}

function needsBuzzerBinding(state) {
  return state.inputProfile?.gamepad === 'host-and-buzzer';
}

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      const requestedSet = action.requestedGame
        ? action.sets.find((set) => set.valid && set.game === action.requestedGame)
        : null;
      if (action.attachedSession || action.diagnosticSession) return attachSession(next, action.sets, action.attachedSession || action.diagnosticSession);
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
    case 'PLAYERS_CONFIRMED':
    case 'TEAMS_CONFIRMED': {
      const seats = action.seats || action.teams || [];
      return { ...state, phase: needsBuzzerBinding(state) ? 'buzzer-bind' : 'playing', seats };
    }
    case 'SET_HOST_MODE':
      return { ...state, hostMode: action.hostMode };
    case 'BIND_DONE':
      return { ...state, phase: 'playing', buzzerBindings: action.bindings || null };
    case 'SESSION_CREATED':
      return { ...state, sessionId: action.sessionId };
    case 'GAME_FINISHED':
      return { ...state, phase: 'results', result: action.result || null };
    case 'PLAY_AGAIN':
      return { ...state, phase: 'set-picker', game: null, setId: null, definitionId: null, presenterId: null, setupProfile: { kind: 'none' }, theme: null, inputProfile: null, lifecycleCapabilities: [], buzzerBindings: null, sessionId: null, result: null };
    default:
      return state;
  }
}
