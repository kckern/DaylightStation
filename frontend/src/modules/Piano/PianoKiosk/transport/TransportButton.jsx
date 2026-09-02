import Icon from '../../ui/icons/Icon.jsx';
import './Transport.scss';

/**
 * TransportButton — the one kiosk transport button primitive (design-system
 * wave 1; audit §4.1). Enforces the touch rules in one place: ≥3rem box,
 * SVG-icon faces (never Unicode glyphs), `is-on` grammar via aria-pressed.
 *
 * @param {string} [icon] - shared icon name (icons/svg/*.svg)
 * @param {string} [label] - ASCII text label; icon and label may combine
 * @param {string} [ariaLabel] - required when icon-only
 * @param {'default'|'primary'|'quiet'|'danger'} [emphasis]
 * @param {'inline'|'tile'|'rail'} [layout] - inline (default) sits in a strip; tile stacks icon over a wrapping label for grids; rail is a full-width icon-left row for a side rail.
 * @param {boolean} [on] - lit/latched state (aria-pressed + .is-on)
 * @param {boolean} [disabled]
 * @param {() => void} [onPress]
 * @param {string} [className] - layout hooks appended by the host
 * @param {boolean} [labelFirst] - render the label span BEFORE the icon (default:
 *   icon-then-label). Escape hatch for mirror-symmetric pairs (e.g. skip±N,
 *   where the numeral must sit innermost, nearest the button it mirrors around).
 */
export default function TransportButton({
  icon, label, ariaLabel, emphasis = 'default', layout = 'inline', on = false,
  disabled = false, onPress, className = '', labelFirst = false, ...rest
}) {
  const classes = [
    'piano-tbtn',
    emphasis !== 'default' ? `piano-tbtn--${emphasis}` : '',
    layout !== 'inline' ? `piano-tbtn--${layout}` : '',
    on ? 'is-on' : '',
    className,
  ].filter(Boolean).join(' ');
  const iconEl = icon && <Icon key="icon" name={icon} />;
  const labelEl = label != null && <span key="label" className="piano-tbtn__label">{label}</span>;
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
      {labelFirst ? <>{labelEl}{iconEl}</> : <>{iconEl}{labelEl}</>}
    </button>
  );
}
