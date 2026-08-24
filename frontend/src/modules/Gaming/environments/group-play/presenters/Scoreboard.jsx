import React from 'react';
import './Scoreboard.scss';
import MemberAvatar from '../ui/MemberAvatar.jsx';

export function Scoreboard({ teams = [], scores = {}, lockedTeamId = null, activeTeamId = null }) {
  return (
    <div className="gp-scoreboard" data-testid="scoreboard">
      {teams.map((team) => (
        <div
          key={team.id}
          className={`gp-scoreboard__team${team.id === lockedTeamId ? ' is-locked' : ''}${team.id === activeTeamId ? ' is-active' : ''}`}
          style={{ '--team-color': team.color || '#888' }}
        >
          <span className="gp-scoreboard__name">{team.name}</span>
          {team.members?.length > 0 && (
            <span className="gp-scoreboard__members">
              {team.members.map((m) => (
                <MemberAvatar key={m.id} member={m} teamColor={team.color} size={22} />
              ))}
            </span>
          )}
          <span className={`gp-scoreboard__score${(scores[team.id] ?? 0) < 0 ? ' is-negative' : ''}`}>
            {(scores[team.id] ?? 0).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
export default Scoreboard;
