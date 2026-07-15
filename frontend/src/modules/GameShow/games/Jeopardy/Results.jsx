import React from 'react';
import TitleCard from '../../shell/components/TitleCard.jsx';
import './Jeopardy.scss';

export function Results({ teams, scores, onPlayAgain, onExit }) {
  const ranked = [...teams].sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));
  const winner = ranked[0];
  return (
    <div className="jp-results" data-testid="results">
      <TitleCard title={`${winner?.name || '—'} wins!`} subtitle="Final scores" />
      <ol className="jp-results__list">
        {ranked.map((t) => (
          <li key={t.id} style={{ '--team-color': t.color }}>
            {t.name}: {(scores[t.id] ?? 0).toLocaleString()}
          </li>
        ))}
      </ol>
      <div className="jp-results__actions">
        <button type="button" autoFocus onClick={onPlayAgain}>Play again</button>
        <button type="button" onClick={onExit}>Exit</button>
      </div>
    </div>
  );
}
export default Results;
