import React from 'react';
import MemberAvatar from '@gaming-ui/MemberAvatar.jsx';
import GameButton from '@gaming-ui/GameButton.jsx';
import OutcomeReveal from '@gaming-ui/OutcomeReveal.jsx';
import './PartyGamesResults.scss';

export default function PartyGamesResults({ seats = [], result = null, onPlayAgain, onExit }) {
  const scoreMap = Object.fromEntries((result?.scores || []).map((score) => [score.subject_id, score.value]));
  const ranked = [...seats].sort((left, right) => (scoreMap[right.id] ?? 0) - (scoreMap[left.id] ?? 0));
  const explicitWinnerIds = result?.outcome?.winner_ids || [];
  const highScore = ranked.length ? scoreMap[ranked[0].id] : null;
  const winners = explicitWinnerIds.length
    ? seats.filter((seat) => explicitWinnerIds.includes(String(seat.id)))
    : highScore != null ? ranked.filter((seat) => scoreMap[seat.id] === highScore) : [];
  const title = winners.length > 1 ? 'It’s a tie' : winners.length === 1 ? `${winners[0].name} wins` : 'Game complete';
  return (
    <div className="party-games-results" data-testid="results">
      <OutcomeReveal tone="success" eyebrow="Final result" title={title}>
        {ranked.length > 0 && <ol className="party-games-results__list">
          {ranked.map((seat) => (
            <li key={seat.id} style={{ '--team-color': seat.color || 'var(--gp-neutral-team)' }}>
              <span className="party-games-results__rank" aria-hidden="true" />
              {seat.members?.map((member) => <MemberAvatar key={member.id} member={member} teamColor={seat.color} size={26} />)}
              <strong>{seat.name}</strong>
              {Object.hasOwn(scoreMap, seat.id) && <span className="party-games-results__score">{scoreMap[seat.id].toLocaleString()}</span>}
            </li>
          ))}
        </ol>}
        {ranked.length === 0 && <p>{result?.status === 'abandoned' ? 'Session ended.' : 'Thanks for playing.'}</p>}
      </OutcomeReveal>
      <div className="party-games-results__actions">
        <GameButton tone="primary" autoFocus onClick={onPlayAgain}>Play another game</GameButton>
        <GameButton tone="quiet" onClick={onExit}>Exit Party Games</GameButton>
      </div>
    </div>
  );
}
