import Icon from './icons/Icon.jsx';

/** Consistent kiosk back control: icon + the name of the destination level. */
export default function PianoBack({ onClick, label }) {
  return (
    <button type="button" className="piano-back" onClick={onClick} aria-label={label ? `Back to ${label}` : 'Back'}>
      <Icon name="back" />
      {label && <span className="piano-back__label">{label}</span>}
    </button>
  );
}
