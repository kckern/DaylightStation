/**
 * PlayerPanel — the "Player" section of the console's game menu: whose save
 * this game is running on, and (for a shared save game nobody has claimed yet)
 * who to continue as or how to start saving. Presentation-only; the host wires
 * load/claim/overwrite.
 *
 *   locked   — the game belongs to one person (save_owner); no actions.
 *   current  — the person whose save is loaded, or null (not saving).
 *   conflict — a person whose existing save a claim would replace; asks first.
 *   canIdentify — false off the garage kiosk: no fingerprint, so no Continue/Save.
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
  onJustPlay = null,
  // False off the garage kiosk: the fingerprint prompt does not exist there,
  // so Continue as / Save as me would wait for a scan nobody can give.
  canIdentify = true,
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
          {canIdentify ? (
            <>
              {/* Always present on the kiosk, at a fixed height, so the list
                  arriving after the menu opens does not shift the buttons.
                  savers === null means the list is still loading. */}
              <div className="emu-player-panel__savers" aria-busy={savers === null ? 'true' : undefined}>
                <span className="emu-player-panel__hint">
                  {savers === null ? '\u00a0' : savers.length === 0 ? 'No saved games yet' : 'Continue as'}
                </span>
                {!savers?.length && (
                  // An invisible avatar button: the row is exactly as tall as a full one.
                  <span className="emu-player-panel__btn emu-player-panel__saver emu-player-panel__placeholder" aria-hidden="true">
                    <span className="emu-player-panel__avatar" />
                    <span>{'\u00a0'}</span>
                  </span>
                )}
                {savers?.length > 0 && savers.map((s) => (
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
              <div className="emu-player-panel__choice">
                <button type="button" className="emu-player-panel__btn emu-player-panel__btn--primary" onClick={onClaim}>
                  Save as me
                </button>
                {onJustPlay && (
                  <button type="button" className="emu-player-panel__btn" data-autofocus onClick={onJustPlay}>Just play</button>
                )}
              </div>
            </>
          ) : (
            <div className="emu-player-panel__choice">
              <span className="emu-player-panel__offkiosk">Saving works at the garage</span>
              {onJustPlay && (
                <button type="button" className="emu-player-panel__btn" data-autofocus onClick={onJustPlay}>Just play</button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default PlayerPanel;
