import { useEffect, useState } from 'react';
import { cardIdenticonCells, GRID_SIZE } from '../../../Gaming/experiences/card-battle/cardIdenticonModel.js';
import OpponentSpeech from './OpponentSpeech.jsx';
import './opponent.scss';

export function OpponentFace({ opponent, name }) {
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => setArtFailed(false), [opponent?.art]);
  if (opponent?.art && !artFailed) return <img className="pg-opponent__art" src={opponent.art} alt="" onError={() => setArtFailed(true)} />;
  return (
    <svg className="pg-opponent__identicon" viewBox={`0 0 ${GRID_SIZE} ${GRID_SIZE}`} aria-hidden="true" data-identicon={name}>
      {cardIdenticonCells(name).flatMap((row, r) => row.map((on, c) => on
        ? <rect key={`${c}-${r}`} x={c + 0.08} y={r + 0.08} width="0.84" height="0.84" rx="0.16" /> : null))}
    </svg>
  );
}

export default function OpponentPanel({
  opponent, level, size = 'md', status = null, thinkMs = null, mood = null,
  speech = null, reactionKey = null, ladder = null, onOpenRoster = null,
}) {
  const name = opponent?.name || `Level ${level ?? 1}`;
  const body = (
    <figure className={[
      'pg-opponent', `pg-opponent--${size}`,
      Number.isFinite(thinkMs) && thinkMs > 0 && 'pg-opponent--thinking',
      mood && !['neutral', 'thinking'].includes(mood) && `pg-opponent--${mood}`,
    ].filter(Boolean).join(' ')} style={thinkMs ? { '--pg-think-ms': `${thinkMs}ms` } : undefined}>
      <div className="pg-opponent__face" key={reactionKey}><OpponentFace opponent={opponent} name={name} /></div>
      <figcaption className="pg-opponent__text">
        <span className="pg-opponent__name">{name}</span>
        {status && <span className="pg-opponent__status">{status}</span>}
        {ladder && <span className="pg-opponent__ladder">Opponent {ladder.position} of {ladder.total} · {ladder.wins} of {ladder.needed} wins</span>}
        <OpponentSpeech speech={speech} />
      </figcaption>
    </figure>
  );
  return onOpenRoster ? <button type="button" className="pg-opponent__button" onClick={onOpenRoster} aria-label={`${name} — see all opponents`}>{body}</button> : body;
}
