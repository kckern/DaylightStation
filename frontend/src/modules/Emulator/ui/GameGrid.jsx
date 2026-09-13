/**
 * GameGrid — centered, wrapping grid of game covers.
 *
 * Always vertically + horizontally centered (one game or twelve). Measures the
 * rendered column count (tiles sharing the first row's offsetTop) and reports it
 * up so the parent's grid navigation can move by rows. Focus is parent-owned
 * (controlled `focusedIndex`) so keyboard/gamepad and pointer stay in sync.
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GameCover } from './GameCover.jsx';
import { computeGridLayout } from './gridLayout.js';

export function GameGrid({ games = [], focusedIndex = 0, onActivate, onColumnsChange, resolveMediaUrl, coverAspect }) {
  const gridRef = useRef(null);
  const wrapRef = useRef(null);
  const tileRefs = useRef([]);
  const [layout, setLayout] = useState(null);

  // Size the tiles to the room they have. A console here holds one game or a
  // handful, so a fixed size is wrong at both ends: what fits a full shelf
  // leaves a single cover adrift in a black field. Measured from the wrapper,
  // which is the panel the grid may use.
  const aspect = Number.isFinite(coverAspect) && coverAspect > 0 ? coverAspect : 1;
  const count = games.length;
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || count === 0) return undefined;
    const measure = () => {
      const r = wrap.getBoundingClientRect();
      setLayout(computeGridLayout({ width: r.width, height: r.height, count, aspect }));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [count, aspect]);

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
  }, [games.length, onColumnsChange, coverAspect, layout]);

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

  // Tile shape is the console's and tile size is the panel's: both travel as
  // custom properties so the track and the tile cannot drift apart.
  const gridStyle = {
    '--emu-cover-aspect': aspect,
    ...(layout ? {
      '--emu-cover-h': `${layout.tile}px`,
      '--emu-cover-gap': `${layout.gap}px`,
      gridTemplateColumns: `repeat(${layout.columns}, var(--emu-cover-w))`,
    } : null),
  };

  return (
    <div className="emu-grid-wrap" ref={wrapRef}>
      <div className="emu-grid" ref={gridRef} role="grid" style={gridStyle}>
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
