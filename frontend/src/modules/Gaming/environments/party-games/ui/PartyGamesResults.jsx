import React from 'react';
import TitleCard from '../../../platform/ui/TitleCard.jsx';
import MemberAvatar from '../../../platform/ui/MemberAvatar.jsx';
import './PartyGamesResults.scss';

export default function PartyGamesResults({ teams, scores, onPlayAgain, onExit }) {
  const ranked = [...teams].sort((left, right) => (scores[right.id] ?? 0) - (scores[left.id] ?? 0));
  const winner = ranked[0];
  return (
    <div className="party-games-results" data-testid="results">
      <TitleCard title={`${winner?.name || 'Game'} complete`} subtitle="Final scores" />
      <ol className="party-games-results__list">
        {ranked.map((team) => (
          <li key={team.id} style={{ '--team-color': team.color }}>
            {team.members?.map((member) => <MemberAvatar key={member.id} member={member} teamColor={team.color} size={26} />)}
            <span>{team.name}: {(scores[team.id] ?? 0).toLocaleString()}</span>
          </li>
        ))}
      </ol>
      <div className="party-games-results__actions">
        <button type="button" autoFocus onClick={onPlayAgain}>Play again</button>
        <button type="button" onClick={onExit}>Exit</button>
      </div>
    </div>
  );
}
