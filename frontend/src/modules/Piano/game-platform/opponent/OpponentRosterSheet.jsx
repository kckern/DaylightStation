import GameSheet from '../chrome/GameSheet.jsx';
import { OpponentFace } from './OpponentPanel.jsx';

export default function OpponentRosterSheet({ roster = [], position = 1, onClose, describe = null }) {
  if (!roster.length) return null;
  return (
    <GameSheet title="Opponents" onClose={onClose} className="pg-roster-sheet">
      <ol className="pg-roster">
        {roster.map((opponent, index) => {
          const rung = Number(opponent.position ?? opponent.level ?? index + 1);
          const state = rung < position ? 'beaten' : rung === position ? 'current' : 'ahead';
          return (
            <li key={opponent.id || rung} className={`pg-roster__row pg-roster__row--${state}`}>
              <span className="pg-roster__level">{rung}</span>
              <span className="pg-roster__face"><OpponentFace opponent={opponent} name={opponent.name || `Level ${rung}`} /></span>
              <span className="pg-roster__copy"><strong>{opponent.name || `Level ${rung}`}</strong>{describe && <small>{describe(opponent, rung)}</small>}</span>
              <span className="pg-roster__state">{state === 'beaten' ? 'Beaten' : state === 'current' ? 'Now' : 'Locked'}</span>
            </li>
          );
        })}
      </ol>
    </GameSheet>
  );
}
