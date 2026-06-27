/**
 * PlayerSelect — the transient post-launch identity surface for save-enabled
 * games. Presentation-only: the host wires load/claim/dismiss. When hidden it
 * collapses to a corner "Players" toggle so an anonymous player can re-open it.
 */
import React from 'react';
import './PlayerSelect.scss';

export function PlayerSelect({
  visible,
  savers = [],
  message = null,
  onLoad = () => {},
  onClaim = () => {},
  onDismiss = () => {},
  onReopen = () => {},
}) {
  if (!visible) {
    return (
      <button
        type="button"
        className="emu-player-select__reopen"
        aria-label="Players"
        onClick={onReopen}
      >
        👥
      </button>
    );
  }

  return (
    <div className="emu-player-select" role="dialog" aria-label="Choose a player">
      <button type="button" className="emu-player-select__dismiss" aria-label="Dismiss" onClick={onDismiss}>✕</button>
      <div className="emu-player-select__title">Continue as…</div>
      {message && <div className="emu-player-select__message">{message}</div>}
      <div className="emu-player-select__savers">
        {savers.length === 0 && <div className="emu-player-select__empty">No saved games yet</div>}
        {savers.map((s) => (
          <button
            key={s.userId}
            type="button"
            className="emu-player-select__saver"
            aria-label={`Continue as ${s.name}`}
            onClick={() => onLoad(s.userId)}
          >
            <img src={s.avatarSrc} alt="" className="emu-player-select__avatar" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <button type="button" className="emu-player-select__claim" onClick={onClaim}>Save my game</button>
    </div>
  );
}

export default PlayerSelect;
