import Icon from '../../ui/icons/Icon.jsx';
import './NoteLauncher.scss';

/**
 * The office-screen game launcher, drawn as the thing it is: a keyboard.
 *
 * Each game is a white key with its note engraved on the face, in the place
 * your eye already looks for it. Nothing explains the interaction because
 * nothing needs to — you see the key, you play the key.
 *
 * One row always, never wrapped. Wrapping to a 5+4 grid would break the 1:1
 * correspondence with the keys under the player's hands, which is the only
 * reason this reads without instructions.
 */
export default function NoteLauncher({ slots = [], timeoutMs = 30000 }) {
  return (
    <div className="note-launcher" role="dialog" aria-label="Pick a game">
      <div className="note-launcher__head">
        <span className="note-launcher__title">Pick a game · play its key</span>
        <div className="note-launcher__timer" aria-hidden="true">
          <i style={{ animationDuration: `${timeoutMs}ms` }} />
        </div>
      </div>

      <ul className="note-launcher__keys" style={{ '--key-count': slots.length }}>
        {slots.map((slot, i) => (
          <li
            key={slot.gameId}
            className={`nl-key${slot.sharpAfter ? ' has-sharp' : ''}`}
            style={{ '--key-index': i }}
          >
            <Icon name={slot.icon} className="nl-key__icon" />
            <span className="nl-key__label">{slot.label}</span>
            <span className="nl-key__note">{slot.noteName}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
