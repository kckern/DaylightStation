import Icon from '../icons/Icon.jsx';
import './Transport.scss';

/**
 * TransportButton — the one kiosk transport button primitive (design-system
 * wave 1; audit §4.1). Enforces the touch rules in one place: ≥3rem box,
 * SVG-icon faces (never Unicode glyphs), `is-on` grammar via aria-pressed.
 *
 * @param {string} [icon] - shared icon name (icons/svg/*.svg)
 * @param {string} [label] - ASCII text label; icon and label may combine
 * @param {string} [ariaLabel] - required when icon-only
 * @param {'default'|'primary'|'quiet'} [emphasis]
 * @param {boolean} [on] - lit/latched state (aria-pressed + .is-on)
 * @param {boolean} [disabled]
 * @param {() => void} [onPress]
 * @param {string} [className] - layout hooks appended by the host
 */
export default function TransportButton({
  icon, label, ariaLabel, emphasis = 'default', on = false,
  disabled = false, onPress, className = '', ...rest
}) {
  const classes = [
    'piano-tbtn',
    emphasis !== 'default' ? `piano-tbtn--${emphasis}` : '',
    on ? 'is-on' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={ariaLabel}
      aria-pressed={on || undefined}
      disabled={disabled}
      onClick={onPress}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {label != null && <span className="piano-tbtn__label">{label}</span>}
    </button>
  );
}
