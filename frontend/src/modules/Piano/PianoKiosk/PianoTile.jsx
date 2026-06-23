import Icon from './icons/Icon.jsx';

/**
 * Shared kiosk tile: an icon + label (+ optional blurb) card with a consistent
 * box, press feedback, and keyboard focus. Used by the home menu and the games
 * picker. `icon` is an Icon name; `onClick` fires on tap.
 */
export default function PianoTile({ icon, label, blurb, onClick, selected }) {
  return (
    <button
      type="button"
      className={`piano-tile${selected ? ' is-selected' : ''}`}
      onClick={onClick}
    >
      {icon && <Icon name={icon} className="piano-tile__icon" />}
      <span className="piano-tile__label">{label}</span>
      {blurb && <span className="piano-tile__blurb">{blurb}</span>}
    </button>
  );
}
