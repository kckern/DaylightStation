/**
 * GameCover — a single game tile (cover art only, no caption).
 *
 * Cover art comes from the emulator art API (SSoT). Many games have no cover
 * yet, so a load error falls back to a titled placeholder tile rather than a
 * broken image.
 */

import React, { useState } from 'react';

export function GameCover({ game, focused = false, onActivate, resolveMediaUrl = (p) => p }) {
  const [broken, setBroken] = useState(false);
  const src = game?.coverUrl ? resolveMediaUrl(game.coverUrl) : null;
  const showFallback = broken || !src;

  return (
    <button
      type="button"
      className={`emu-cover${focused ? ' is-focused' : ''}${showFallback ? ' is-fallback' : ''}`}
      data-game-id={game?.id}
      aria-label={game?.title || game?.id}
      // Low-latency tap for the garage touchscreen (matches the rest of fitness).
      onPointerDown={() => onActivate?.(game)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate?.(game); }
      }}
    >
      {showFallback ? (
        <span className="emu-cover__fallback">{game?.title || game?.id}</span>
      ) : (
        <img className="emu-cover__img" src={src} alt="" onError={() => setBroken(true)} />
      )}
    </button>
  );
}

export default GameCover;
