// Editable team roster. Teams always carry sequential ids/slots
// (team_1/slot_1 …) so buzzer configs can address them stably.

import { TEAM_COLORS as COLORS } from './teamColors.js';

function reslot(teams) {
  return teams.map((t, i) => ({ ...t, id: `team_${i + 1}`, slot: `slot_${i + 1}` }));
}

function fromPreset(preset) {
  return reslot((preset.teams || []).map((t, i) => ({
    name: t.name || `Team ${i + 1}`,
    color: t.color || COLORS[i % COLORS.length],
    members: [...(t.members || [])],
  })));
}

function defaultTeams() {
  return reslot([
    { name: 'Team 1', color: COLORS[0], members: [] },
    { name: 'Team 2', color: COLORS[1], members: [] },
  ]);
}

export function initTeamSetup(config = {}) {
  const preset = (config.team_presets || [])[0] || null;
  return {
    presetId: preset?.id || null,
    teams: preset ? fromPreset(preset) : defaultTeams(),
  };
}

export function teamSetupReducer(state, action) {
  switch (action.type) {
    case 'LOAD_PRESET':
      return { presetId: action.preset.id, teams: fromPreset(action.preset) };
    case 'ADD_TEAM': {
      const n = state.teams.length;
      return { ...state, teams: reslot([...state.teams, { name: `Team ${n + 1}`, color: COLORS[n % COLORS.length], members: [] }]) };
    }
    case 'REMOVE_TEAM':
      return { ...state, teams: reslot(state.teams.filter((t) => t.id !== action.teamId)) };
    case 'RENAME_TEAM':
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, name: action.name } : t)) };
    case 'ASSIGN_MEMBER': {
      const stripped = state.teams.map((t) => ({ ...t, members: t.members.filter((m) => m.id !== action.member.id) }));
      return { ...state, teams: stripped.map((t) => (t.id === action.teamId ? { ...t, members: [...t.members, action.member] } : t)) };
    }
    case 'REMOVE_MEMBER':
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, members: t.members.filter((m) => m.id !== action.memberId) } : t)) };
    case 'ADD_GUEST': {
      const taken = new Set(state.teams.flatMap((t) => t.members.map((m) => m.id)));
      let n = 1;
      while (taken.has(`guest_${n}`)) n += 1;
      const guest = { id: `guest_${n}`, name: `Guest ${n}`, avatar: null };
      return { ...state, teams: state.teams.map((t) => (t.id === action.teamId ? { ...t, members: [...t.members, guest] } : t)) };
    }
    default:
      return state;
  }
}
