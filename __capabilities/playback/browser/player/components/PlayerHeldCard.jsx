import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

/**
 * The held card: what a held video says and offers (heldRecoveryModel).
 *
 * A solid card, not a spinner: once recovery has stopped, nothing is loading,
 * and a spinning ring says otherwise. On a D-pad the first enabled action takes
 * focus so OK acts at once; arrows move between actions (the overlay's own
 * key handler). Touch gets plain tap targets; numpad and no-input surfaces get
 * no buttons at all — the card names the keys that work, or the plan.
 */
export function PlayerHeldCard({ model, onAction }) {
  const rowRef = useRef(null);
  const focusKey = model.focusable ? model.actions.map((a) => `${a.id}:${a.disabled ? 0 : 1}`).join('|') : '';
  useEffect(() => {
    if (!model.focusable) return;
    const row = rowRef.current;
    const first = row?.querySelector('button:not(:disabled)');
    const active = document.activeElement;
    // Take focus only from nowhere (body) or from this card's own disabled
    // control (a cooldown ending) — never from another control on the page.
    const free = !active || active === document.body || active === document.documentElement
      || (row?.contains(active) && active.disabled === true);
    if (first && free) first.focus({ preventScroll: true });
  }, [model.focusable, focusKey]);

  return (
    <div className="player-held-card" role="alertdialog" aria-live="polite" aria-label={model.headline}
      data-testid="player-held-card" data-no-fullscreen="true">
      <div className="player-held-card__headline">{model.headline}</div>
      {model.detail ? <div className="player-held-card__detail">{model.detail}</div> : null}
      {model.plan ? <div className="player-held-card__plan" data-testid="player-held-plan">{model.plan}</div> : null}
      {model.actions.length > 0 ? (
        <div className="player-held-card__actions" ref={rowRef}>
          {model.actions.map((action, i) => (
            <button
              key={action.id}
              type="button"
              className={`player-held-card__action${i === 0 ? ' player-held-card__action--primary' : ''}`}
              data-action={action.id}
              disabled={action.disabled === true}
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onAction(action); }}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {model.keyHint ? (
        <div className="player-held-card__keys" data-testid="player-held-keys">
          {model.keyHint.split(/ {4}/).map((part) => {
            const [key, ...rest] = part.split(/ {2}/);
            return (
              <span key={part} className="player-held-card__key-pair">
                <kbd className="player-held-card__key">{key}</kbd>{rest.join('  ')}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

PlayerHeldCard.propTypes = {
  model: PropTypes.shape({
    headline: PropTypes.string.isRequired,
    detail: PropTypes.string,
    plan: PropTypes.string,
    actions: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, label: PropTypes.string, disabled: PropTypes.bool })).isRequired,
    focusable: PropTypes.bool,
    keyHint: PropTypes.string,
  }).isRequired,
  onAction: PropTypes.func.isRequired,
};

export default PlayerHeldCard;
