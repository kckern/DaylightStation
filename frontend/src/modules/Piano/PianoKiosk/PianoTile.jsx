import Icon from './icons/Icon.jsx';

/**
 * Shared kiosk tile: an icon + label (+ optional blurb) card with a consistent
 * box, press feedback, and keyboard focus. Used by the home menu and the games
 * picker. `icon` is an Icon name; `onClick` fires on tap. `disabled` greys the
 * tile out and blocks interaction (used for modes that are visible but not yet
 * available, e.g. Producer on the home menu).
 */
export default function PianoTile({ icon, label, blurb, onClick, selected, disabled }) {
  return (
    <button
      type="button"
      className={`piano-tile${selected ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={disabled || undefined}
    >
      {icon && <Icon name={icon} className="piano-tile__icon" />}
      <span className="piano-tile__label">{label}</span>
      {blurb && <span className="piano-tile__blurb">{blurb}</span>}
    </button>
  );
}
