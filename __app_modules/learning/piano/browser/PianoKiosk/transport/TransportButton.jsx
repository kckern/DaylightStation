import { useEffect, useId, useState } from 'react';
import Icon from '../../ui/icons/Icon.jsx';
import getLogger from '../../../../../../frontend/src/lib/logging/Logger.js';
import './Transport.scss';

/**
 * TransportButton — the one kiosk transport button primitive (design-system
 * wave 1; audit §4.1). Enforces the touch rules in one place: ≥3rem box,
 * SVG-icon faces (never Unicode glyphs), `is-on` grammar via aria-pressed.
 *
 * @param {string} [icon] - shared icon name (icons/svg/*.svg)
 * @param {string} [art] - illustration URL; when set it takes the icon's place. The icon is the fallback — pass both — and comes back if the art fails to load.
 * @param {string} [label] - ASCII text label; icon and label may combine
 * @param {string} [ariaLabel] - required when icon-only
 * @param {'default'|'primary'|'quiet'|'danger'} [emphasis]
 * @param {'inline'|'tile'|'rail'|'row'} [layout] - inline (default) sits in a strip; tile stacks icon over a wrapping label for grids; rail is a full-width icon-left row for a side rail; row is an icon-left card with the label over a `hint` line and an optional `trailing` icon (a settings entry that opens a view).
 * @param {string} [hint] - one short line under the label. Kept out of the accessible
 *   name (aria-hidden) and wired as the description instead, so the button is still
 *   found and announced by its label alone.
 * @param {string} [trailing] - icon name drawn at the far edge (e.g. `chevron-right` for "opens a view").
 * @param {boolean} [on] - lit/latched state (aria-pressed + .is-on)
 * @param {boolean} [disabled]
 * @param {() => void} [onPress]
 * @param {string} [className] - layout hooks appended by the host
 * @param {boolean} [labelFirst] - render the label span BEFORE the icon (default:
 *   icon-then-label). Escape hatch for mirror-symmetric pairs (e.g. skip±N,
 *   where the numeral must sit innermost, nearest the button it mirrors around).
 */
export default function TransportButton({
  icon, art, label, ariaLabel, emphasis = 'default', layout = 'inline', on = false,
  disabled = false, onPress, className = '', labelFirst = false, hint, trailing, ...rest
}) {
  const hintId = useId();
  const classes = [
    'piano-tbtn',
    emphasis !== 'default' ? `piano-tbtn--${emphasis}` : '',
    layout !== 'inline' ? `piano-tbtn--${layout}` : '',
    on ? 'is-on' : '',
    className,
  ].filter(Boolean).join(' ');
  // A 404 (pack not synced, file renamed) must not leave a broken-image glyph on a kiosk tile.
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => { setArtFailed(false); }, [art]);
  const iconEl = art && !artFailed
    ? <img key="icon" className="piano-tbtn__art" src={art} alt="" draggable={false} decoding="async" onError={() => setArtFailed(true)} />
    : icon && <Icon key="icon" name={icon} />;
  // Fallback is invisible by design (a glyph instead of a picture), so the
  // condition that causes it — an unsynced pack on prod, a renamed file — is
  // logged, sampled so a whole grid of 404s is one line, not twenty-four.
  useEffect(() => {
    if (artFailed && art) getLogger().child({ component: 'transport-button' }).sampled('piano.tile.art-failed', { art }, { maxPerMinute: 5, aggregate: true });
  }, [artFailed, art]);
  const labelEl = label != null && <span key="label" className="piano-tbtn__label">{label}</span>;
  const hintEl = hint && <span key="hint" id={hintId} className="piano-tbtn__hint" aria-hidden>{hint}</span>;
  const trailingEl = trailing && <span key="trail" className="piano-tbtn__trail"><Icon name={trailing} /></span>;
  return (
    <button
      type="button"
      className={classes}
      aria-label={ariaLabel}
      aria-pressed={on || undefined}
      aria-describedby={hint ? hintId : undefined}
      disabled={disabled}
      onClick={onPress}
      {...rest}
    >
      {labelFirst ? <>{labelEl}{iconEl}</> : <>{iconEl}{labelEl}</>}
      {hintEl}{trailingEl}
    </button>
  );
}
