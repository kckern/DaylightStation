/**
 * GameGrid — centered, wrapping grid of game covers.
 *
 * Always vertically + horizontally centered (one game or twelve). Measures the
 * rendered column count (tiles sharing the first row's offsetTop) and reports it
 * up so the parent's grid navigation can move by rows. Focus is parent-owned
 * (controlled `focusedIndex`) so keyboard/gamepad and pointer stay in sync.
 */

import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { GameCover } from './GameCover.jsx';

export function GameGrid({ games = [], focusedIndex = 0, onActivate, onColumnsChange, resolveMediaUrl }) {
  const gridRef = useRef(null);
  const tileRefs = useRef([]);

  // Measure columns: how many tiles share the first row's offsetTop.
  useLayoutEffect(() => {
    const measure = () => {
      const tiles = tileRefs.current.filter(Boolean);
      if (tiles.length === 0) { onColumnsChange?.(1); return; }
      const top0 = tiles[0].offsetTop;
      let cols = 0;
      for (const t of tiles) { if (t.offsetTop === top0) cols += 1; else break; }
      onColumnsChange?.(Math.max(1, cols));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && gridRef.current) ro.observe(gridRef.current);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [games.length, onColumnsChange]);

  // Keep the focused tile scrolled into view + DOM-focused for a11y.
  useEffect(() => {
    const el = tileRefs.current[focusedIndex];
    if (el) {
      el.focus?.({ preventScroll: true });
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }, [focusedIndex]);

  if (games.length === 0) {
    return (
      <div className="emu-grid-wrap emu-grid-wrap--empty">
        <p className="emu-grid__empty">No games yet</p>
      </div>
    );
  }

  return (
    <div className="emu-grid-wrap">
      <div className="emu-grid" ref={gridRef} role="grid">
        {games.map((game, i) => (
          <div className="emu-grid__cell" key={game.id} ref={(el) => { tileRefs.current[i] = el; }}>
            <GameCover
              game={game}
              focused={i === focusedIndex}
              onActivate={onActivate}
              resolveMediaUrl={resolveMediaUrl}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default GameGrid;
