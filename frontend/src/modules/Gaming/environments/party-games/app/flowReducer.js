import { TEAM_COLORS } from '@gaming-ui/teamColors.js';

// Outer shell flow: loading → set-picker → team-setup → buzzer-bind → playing
// → results. Game-agnostic — knows nothing about
// what happens inside 'playing' (the mounted game owns that).

export const initialFlowState = {
  phase: 'loading',
  config: null,
  sets: [],
  competition: true,
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
    competition: set.competition !== false,
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

function attachSession(state, sets, session, requestedDefinition) {
  const diagnosticDefinitionId = session?.diagnostic?.definition_id || requestedDefinition;
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
    competition: session.state?.competition ?? mounted.competition ?? true,
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

function selectConfiguredSet(state, set, overrides = {}) {
  const launch = { ...set?.launch, ...overrides };
  if (!launch.autostart) return selectSet(state, set);
  const ids = launch.participants;
  let error;
  if (!set) error = 'Configured game is not available';
  else if ((set.setupProfile?.kind || set.setup) !== 'individuals') error = 'Automatic participant setup requires an individual game';
  else if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length) error = 'Automatic setup requires distinct participant IDs';
  const known = new Map((state.config?.household_members || []).map(member => [member.id, member]));
  if (!error) {
    const unknown = ids.find(id => !known.has(id));
    if (unknown) error = `Unknown configured participant: ${unknown}`;
  }
  if (error) return { ...state, phase: 'loading', error };
  const seats = ids.map((id, index) => ({
    id, name: known.get(id).name, members: [known.get(id)],
    color: TEAM_COLORS[index % TEAM_COLORS.length], slot: `slot_${index + 1}`,
  }));
  const selected = selectSet(state, set);
  return { ...selected, seats, phase: needsBuzzerBinding(selected) ? 'buzzer-bind' : 'playing' };
}

export function flowReducer(state, action) {
  switch (action.type) {
    case 'BOOT_LOADED': {
      const next = { ...state, config: action.config, sets: action.sets, error: null };
      const requestedSet = action.sets.find((set) => set.valid && (action.requestedDefinition
        ? set.definitionId === action.requestedDefinition
        : action.requestedGame && set.game === action.requestedGame));
      if (action.attachedSession || action.diagnosticSession) return attachSession(next, action.sets, action.attachedSession || action.diagnosticSession, action.requestedDefinition);
      if (requestedSet || action.launch?.autostart) return selectConfiguredSet(next, requestedSet, action.launch);
      return { ...next, phase: 'set-picker' };
    }
    case 'BOOT_FAILED':
      return { ...state, error: action.error };
    case 'PICK_SET':
      return selectConfiguredSet(state, {
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
