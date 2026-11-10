import React, {useLayoutEffect, useRef} from 'react';
import BabyIcon from "./BabyIcon.jsx";
import "./Jeopardy.scss";

export function Board({ round, used, roundIndex, cursor = {cat:0,row:0}, onSelect, interactive = true, teams = [], selected = null }) {
  const tileRefs = useRef(new Map());
  useLayoutEffect(() => {
    if (!interactive) return;
    const tile = tileRefs.current.get(`${cursor.cat}:${cursor.row}`);
    if (tile && !tile.disabled) tile.focus();
  }, [cursor.cat, cursor.row, roundIndex, interactive]);
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
          const isCursor = interactive && cursor.cat === c && cursor.row === r && !isUsed && Boolean(clue);
          const owner = teams.find(team => team.id === clue?.assigned_team_id);
          const selectedTile = selected?.cat === c && selected?.row === r;
          const Tile = interactive ? 'button' : 'div';
          return (
            <Tile key={`${c}:${r}`} type={interactive ? "button" : undefined} role="gridcell"
              ref={node => { if (node) tileRefs.current.set(`${c}:${r}`, node); else tileRefs.current.delete(`${c}:${r}`); }}
              data-remote-autofocus={isCursor || undefined}
              disabled={interactive ? isUsed || !clue : undefined}
              aria-label={clue ? `${cat.name} for $${clue.value * Number(round.multiplier ?? 1)}${isUsed ? ', used' : ''}${clue.little_kids && !isUsed ? ', Little kids’ turn' : ''}${owner && !isUsed ? `, ${owner.name} answers` : ''}` : `${cat.name}, no clue`}
              tabIndex={interactive ? (isCursor && !isUsed && clue ? 0 : -1) : undefined}
              onClick={interactive ? () => clue && !isUsed && onSelect?.(c, r) : undefined}
              style={owner ? { '--team-color': owner.color } : undefined}
              className={`jp-board__tile${isUsed || !clue ? ' is-used' : ''}${isCursor ? ' is-cursor' : ''}${selectedTile ? ' is-selected' : ''}`}>
              {!isUsed && clue ? <><span>${clue.value * Number(round.multiplier ?? 1)}</span>{clue.little_kids && <BabyIcon className="jp-board__kids" decorative />}{owner && <span className="jp-board__owner">{owner.name}</span>}</> : ''}
            </Tile>
          );
        })
      )}
    </div>
  );
}
export default Board;
