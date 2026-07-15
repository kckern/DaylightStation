import React from 'react';
import './Scoreboard.scss';
import MemberAvatar from '../components/MemberAvatar.jsx';

export function Scoreboard({ teams = [], scores = {}, lockedTeamId = null, activeTeamId = null }) {
  return (
    <div className="gs-scoreboard" data-testid="scoreboard">
      {teams.map((team) => (
        <div
          key={team.id}
          className={`gs-scoreboard__team${team.id === lockedTeamId ? ' is-locked' : ''}${team.id === activeTeamId ? ' is-active' : ''}`}
          style={{ '--team-color': team.color || '#888' }}
        >
          <span className="gs-scoreboard__name">{team.name}</span>
          {team.members?.length > 0 && (
            <span className="gs-scoreboard__members">
              {team.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={team.color} size={22} />
              ))}
            </span>
          )}
          <span className={`gs-scoreboard__score${(scores[team.id] ?? 0) < 0 ? ' is-negative' : ''}`}>
            {(scores[team.id] ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
export default Scoreboard;
