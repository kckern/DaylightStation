import React from 'react';
import './Jeopardy.scss';

export function Board({ round, used, roundIndex, cursor, onSelect }) {
  const rows = Math.max(...round.categories.map((c) => c.clues.length));
  return (
    <div className="jp-board" data-testid="jeopardy-board" role="grid" aria-label={`${round.name || 'Jeopardy'} board`}
      style={{ '--cats': round.categories.length, '--rows': rows }}>
      {round.categories.map((cat, c) => (
        <div key={cat.name + c} className="jp-board__cat" role="columnheader">{cat.name}</div>
      ))}
      {Array.from({ length: rows }).flatMap((_, r) =>
        round.categories.map((cat, c) => {
          const clue = cat.clues[r] || null;
          const isUsed = !!used[`${roundIndex}:${c}:${r}`];
          const isCursor = cursor.cat === c && cursor.row === r;
          return (
            <button key={`${c}:${r}`} type="button" role="gridcell"
              disabled={isUsed || !clue}
              aria-label={clue ? `${cat.name} for $${clue.value * Number(round.multiplier ?? 1)}${isUsed ? ', used' : ''}` : `${cat.name}, no clue`}
              tabIndex={isCursor && !isUsed && clue ? 0 : -1}
              onClick={() => clue && !isUsed && onSelect?.(c, r)}
              className={`jp-board__tile${isUsed || !clue ? ' is-used' : ''}${isCursor ? ' is-cursor' : ''}`}>
              {!isUsed && clue ? `$${clue.value * Number(round.multiplier ?? 1)}` : ''}
            </button>
          );
        })
      )}
    </div>
  );
}
export default Board;
