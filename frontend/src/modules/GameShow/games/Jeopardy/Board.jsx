import React from 'react';
import './Jeopardy.scss';

export function Board({ round, used, roundIndex, cursor }) {
  const rows = Math.max(...round.categories.map((c) => c.clues.length));
  return (
    <div className="jp-board" data-testid="jeopardy-board"
      style={{ '--cats': round.categories.length, '--rows': rows }}>
      {round.categories.map((cat, c) => (
        <div key={cat.name + c} className="jp-board__cat">{cat.name}</div>
      ))}
      {Array.from({ length: rows }).flatMap((_, r) =>
        round.categories.map((cat, c) => {
          const clue = cat.clues[r] || null;
          const isUsed = !!used[`${roundIndex}:${c}:${r}`];
          const isCursor = cursor.cat === c && cursor.row === r;
          return (
            <div key={`${c}:${r}`}
              className={`jp-board__tile${isUsed || !clue ? ' is-used' : ''}${isCursor ? ' is-cursor' : ''}`}>
              {!isUsed && clue ? `$${clue.value * round.multiplier}` : ''}
            </div>
          );
        })
      )}
    </div>
  );
}
export default Board;
