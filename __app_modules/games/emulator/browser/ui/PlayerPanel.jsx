/**
 * PlayerPanel — the "Player" section of the console's game menu: whose save
 * this game is running on, and (for a shared save game nobody has claimed yet)
 * who to continue as or how to start saving. Presentation-only; the host wires
 * load/claim/overwrite.
 *
 *   locked   — the game belongs to one person (save_owner); no actions.
 *   current  — the person whose save is loaded, or null (not saving).
 *   conflict — a person whose existing save a claim would replace; asks first.
 */
import React from 'react';
import "./PlayerPanel.scss";

function Person({ person }) {
  return (
    <span className="emu-player-panel__person">
      {person.avatarSrc
        ? <img src={person.avatarSrc} alt="" className="emu-player-panel__avatar" />
        : <span className="emu-player-panel__avatar" aria-hidden="true" />}
      <span>{person.name}</span>
    </span>
  );
}

export function PlayerPanel({
  current = null,
  locked = false,
  savers = [],
  message = null,
  conflict = null,
  onLoad = () => {},
  onClaim = () => {},
  onConfirmOverwrite = () => {},
  onCancelOverwrite = () => {},
}) {
  return (
    <section className="emu-player-panel" aria-label="Player">
      <div className="emu-player-panel__label">Player</div>

      {current ? (
        <div className="emu-player-panel__current">
          <Person person={current} />
          <span className="emu-player-panel__status">
            {locked ? `${current.name}'s game · saving` : 'Saving'}
          </span>
        </div>
      ) : (
        <div className="emu-player-panel__current emu-player-panel__current--anon">
          <span className="emu-player-panel__status">Not saving</span>
        </div>
      )}

      {message && <div className="emu-player-panel__message" role="status">{message}</div>}

      {!current && !locked && conflict && (
        <div className="emu-player-panel__conflict" role="alert">
          <p>This replaces {conflict.name}&apos;s saved game.</p>
          <div className="emu-player-panel__actions">
            <button type="button" className="emu-player-panel__btn" onClick={onCancelOverwrite}>Cancel</button>
            <button type="button" className="emu-player-panel__btn emu-player-panel__btn--danger" onClick={() => onConfirmOverwrite(conflict.userId)}>
              Overwrite
            </button>
          </div>
        </div>
      )}

      {!current && !locked && !conflict && (
        <>
          {savers.length > 0 && (
            <div className="emu-player-panel__savers">
              <span className="emu-player-panel__hint">Continue as</span>
              {savers.map((s) => (
                <button
                  key={s.userId}
                  type="button"
                  className="emu-player-panel__btn emu-player-panel__saver"
                  aria-label={`Continue as ${s.name}`}
                  onClick={() => onLoad(s.userId)}
                >
                  <Person person={s} />
                </button>
              ))}
            </div>
          )}
          <button type="button" className="emu-player-panel__btn emu-player-panel__btn--primary" onClick={onClaim}>
            Save as me
          </button>
        </>
      )}
    </section>
  );
}

export default PlayerPanel;
