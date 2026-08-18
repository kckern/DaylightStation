import Icon from '../../ui/icons/Icon.jsx';
import { ChordStaffRenderer } from '../../../MusicNotation/renderers/ChordStaffRenderer.jsx';
import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
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
/**
 * One row of keys, used for BOTH levels of the pick: which game, and who is
 * playing. They are the same gesture — you see the key, you play the key — so
 * they are the same component rather than a keyboard for one and a tap-only
 * modal for the other, which is what shipped first and was unusable on a screen
 * with no touch.
 *
 * A slot renders an avatar when it names a user and an icon when it names a
 * game; everything else about the key is identical.
 */
export default function NoteLauncher({
  slots = [], timeoutMs = 30000, playerName = null,
  title = 'Pick a game · play its key', variant = 'games', showTimer = true,
}) {
  return (
    <div className={`note-launcher note-launcher--${variant}`} role="dialog" aria-label={title}>
      <div className="note-launcher__head">
        <span className="note-launcher__title">{title}</span>
        {showTimer && (
          <div className="note-launcher__timer" aria-hidden="true">
            <i style={{ animationDuration: `${timeoutMs}ms` }} />
          </div>
        )}

        {/* Who the result gets filed under, and how to change it. Named rather
            than implied: the office screen cannot know who sat down, and a
            silent default is how results end up under the wrong person. */}
        <span className="note-launcher__player">
          {playerName
            ? <><b>{playerName}</b><i>top key to change</i></>
            : <b>Nobody yet — play the top key</b>}
        </span>
      </div>

      <ul className="note-launcher__keys" style={{ '--key-count': slots.length }}>
        {slots.map((slot, i) => (
          <li
            key={slot.gameId ?? slot.userId}
            className={`nl-key${slot.sharpAfter ? ' has-sharp' : ''}`}
            style={{ '--key-index': i }}
          >
            {/* The note as NOTATION, not just a letter. This surface teaches
                reading everywhere else — chess and checkers are addressed by
                playing what is on the staff — so the picker says it the same
                way, and the letter stays underneath as the answer key. */}
            <ChordStaffRenderer
              notes={[slot.note]}
              className="chord-staff nl-key__staff"
            />
            <span className="nl-key__label">{slot.label}</span>
            <span className="nl-key__note">{slot.noteName}</span>
            {/* Last in the column, so it lands at the key's tip — see the
                `justify-content: flex-end` in NoteLauncher.scss. */}
            {slot.userId
              ? <span className="nl-key__avatar"><ProfileAvatar id={slot.userId} name={slot.label} size={160} /></span>
              : <Icon name={slot.icon} className="nl-key__icon" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
