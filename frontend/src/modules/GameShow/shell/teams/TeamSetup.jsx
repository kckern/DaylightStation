// TV-friendly team editor: preset row on top, team columns, all-users pool
// at the bottom. Every control is a <button> so arrow-key / gamepad focus
// traversal works without a custom focus engine.
import React, { useReducer, useMemo } from 'react';
import { teamSetupReducer, initTeamSetup } from './teamSetupReducer.js';
import './TeamSetup.scss';

export function TeamSetup({ config, onConfirm }) {
  const [state, dispatch] = useReducer(teamSetupReducer, config, initTeamSetup);
  const presets = config?.team_presets || [];

  // Pool = every member known from presets, minus those already on a team.
  const pool = useMemo(() => {
    const assigned = new Set(state.teams.flatMap((t) => t.members.map((m) => m.id)));
    const all = new Map();
    for (const p of presets) {
      for (const t of p.teams) for (const m of t.members) all.set(m.id, m);
    }
    return [...all.values()].filter((m) => !assigned.has(m.id));
  }, [presets, state.teams]);

  return (
    <div className="gs-teamsetup" data-testid="team-setup">
      {presets.length > 0 && (
        <div className="gs-teamsetup__presets">
          {presets.map((p) => (
            <button key={p.id} type="button"
              className={`gs-chip${state.presetId === p.id ? ' is-active' : ''}`}
              onClick={() => dispatch({ type: 'LOAD_PRESET', preset: p })}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="gs-teamsetup__teams">
        {state.teams.map((team) => (
          <div key={team.id} className="gs-teamsetup__team" style={{ '--team-color': team.color }}>
            <div className="gs-teamsetup__teamname">{team.name}</div>
            {team.members.map((m) => (
              <button key={m.id} type="button" className="gs-chip gs-chip--member"
                onClick={() => dispatch({ type: 'REMOVE_MEMBER', teamId: team.id, memberId: m.id })}>
                {m.name} ×
              </button>
            ))}
            {pool.map((m) => (
              <button key={`add-${m.id}`} type="button" className="gs-chip gs-chip--pool"
                onClick={() => dispatch({ type: 'ASSIGN_MEMBER', teamId: team.id, member: m })}>
                + {m.name}
              </button>
            ))}
            <button type="button" className="gs-chip gs-chip--pool"
              onClick={() => dispatch({ type: 'ADD_GUEST', teamId: team.id })}>
              + Guest
            </button>
            {state.teams.length > 2 && (
              <button type="button" className="gs-chip gs-chip--danger"
                onClick={() => dispatch({ type: 'REMOVE_TEAM', teamId: team.id })}>
                Remove team
              </button>
            )}
          </div>
        ))}
        <button type="button" className="gs-teamsetup__add" onClick={() => dispatch({ type: 'ADD_TEAM' })}>+ Team</button>
      </div>

      <button type="button" className="gs-teamsetup__confirm" data-testid="teams-confirm"
        onClick={() => onConfirm?.(state.teams)}>
        Start with {state.teams.length} teams
      </button>
    </div>
  );
}
export default TeamSetup;
