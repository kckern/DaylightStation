// TV-friendly team editor: preset row on top, team columns, all-users pool
// at the bottom. Every control is a <button> so arrow-key / gamepad focus
// traversal works without a custom focus engine.
import React, { useReducer, useMemo, useState } from 'react';
import { teamSetupReducer, initTeamSetup } from './teamSetupReducer.js';
import { TEAM_COLORS } from '../../../platform/ui/teamColors.js';
import MemberAvatar from '../../../platform/ui/MemberAvatar.jsx';
import './TeamSetup.scss';

export function TeamSetup({ config, setupKind = 'teams', onConfirm }) {
  const [state, dispatch] = useReducer(teamSetupReducer, config, initTeamSetup);
  const [mode, setMode] = useState(setupKind === 'individuals' ? 'individuals' : 'teams');
  const [individuals, setIndividuals] = useState([]);
  const presets = useMemo(() => config?.team_presets || [], [config?.team_presets]);

  const members = useMemo(() => {
    const all = new Map((config?.household_members || []).map((member) => [member.id, member]));
    for (const preset of presets) for (const team of preset.teams) for (const member of team.members) all.set(member.id, member);
    return [...all.values()];
  }, [config?.household_members, presets]);

  // Pool = every member known from presets, minus those already on a team.
  const pool = useMemo(() => {
    const assigned = new Set(state.teams.flatMap((t) => t.members.map((m) => m.id)));
    return members.filter((member) => !assigned.has(member.id));
  }, [members, state.teams]);

  const individualSeats = individuals.map((member, index) => ({
    id: member.id,
    name: member.name,
    color: TEAM_COLORS[index % TEAM_COLORS.length],
    slot: `slot_${index + 1}`,
    members: [member],
  }));

  return (
    <div className="gp-teamsetup" data-testid="team-setup">
      {setupKind === 'individuals-or-teams' && <div className="gp-teamsetup__presets" aria-label="Play mode">
        <button type="button" className={`gp-chip${mode === 'individuals' ? ' is-active' : ''}`} aria-pressed={mode === 'individuals'} onClick={() => setMode('individuals')}>Individuals</button>
        <button type="button" className={`gp-chip${mode === 'teams' ? ' is-active' : ''}`} aria-pressed={mode === 'teams'} onClick={() => setMode('teams')}>Teams</button>
      </div>}

      {mode === 'individuals' && <div className="gp-teamsetup__individuals" aria-label="Individual players">
        {members.map((member) => {
          const selected = individuals.some((candidate) => candidate.id === member.id);
          return <button key={member.id} type="button" className={`gp-chip gp-chip--member${selected ? ' is-active' : ''}`} aria-pressed={selected} onClick={() => setIndividuals((current) => selected ? current.filter((candidate) => candidate.id !== member.id) : [...current, member])}><MemberAvatar member={member} size={26} />{member.name}</button>;
        })}
        <button type="button" className="gp-chip gp-chip--pool" onClick={() => setIndividuals((current) => {
          let index = 1; const taken = new Set(current.map((member) => member.id)); while (taken.has(`guest_${index}`)) index += 1;
          return [...current, { id: `guest_${index}`, name: `Guest ${index}`, avatar: null }];
        })}>+ Guest</button>
      </div>}

      {mode === 'teams' && <>
      {presets.length > 0 && (
        <div className="gp-teamsetup__presets">
          {presets.map((p) => (
            <button key={p.id} type="button"
              className={`gp-chip${state.presetId === p.id ? ' is-active' : ''}`}
              onClick={() => dispatch({ type: 'LOAD_PRESET', preset: p })}>
              {p.name}
            </button>
          ))}
        </div>
      )}

      <div className="gp-teamsetup__teams">
        {state.teams.map((team) => (
          <div key={team.id} className="gp-teamsetup__team" style={{ '--team-color': team.color }}>
            <div className="gp-teamsetup__teamname">{team.name}</div>
            {team.members.map((m) => (
              <button key={m.id} type="button" className="gp-chip gp-chip--member"
                onClick={() => dispatch({ type: 'REMOVE_MEMBER', teamId: team.id, memberId: m.id })}>
                <MemberAvatar member={m} teamColor={team.color} size={26} />
                {m.name} ×
              </button>
            ))}
            {pool.map((m) => (
              <button key={`add-${m.id}`} type="button" className="gp-chip gp-chip--pool"
                onClick={() => dispatch({ type: 'ASSIGN_MEMBER', teamId: team.id, member: m })}>
                <MemberAvatar member={m} teamColor={team.color} size={22} />
                + {m.name}
              </button>
            ))}
            <button type="button" className="gp-chip gp-chip--pool"
              onClick={() => dispatch({ type: 'ADD_GUEST', teamId: team.id })}>
              + Guest
            </button>
            {state.teams.length > 2 && (
              <button type="button" className="gp-chip gp-chip--danger"
                onClick={() => dispatch({ type: 'REMOVE_TEAM', teamId: team.id })}>
                Remove team
              </button>
            )}
          </div>
        ))}
        <button type="button" className="gp-teamsetup__add" onClick={() => dispatch({ type: 'ADD_TEAM' })}>+ Team</button>
      </div>
      </>}

      <button type="button" className="gp-teamsetup__confirm" data-testid="teams-confirm"
        disabled={mode === 'individuals' && individualSeats.length === 0}
        onClick={() => onConfirm?.(mode === 'individuals' ? individualSeats : state.teams)}>
        {mode === 'individuals' ? `Start with ${individualSeats.length} players` : `Start with ${state.teams.length} teams`}
      </button>
    </div>
  );
}
export default TeamSetup;
