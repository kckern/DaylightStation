import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import './PlayerConfirm.scss';

/**
 * A short ceremony confirming who was just chosen.
 *
 * Picking a player is a single key press against a row of six faces, and the row
 * disappears the instant it lands — so the only feedback was the game row
 * appearing, which says nothing about WHO. On a shared instrument, where the
 * answer decides whose record a game is filed under, "did that pick me or my
 * brother" is not a question the player should have to hold.
 *
 * Deliberately brief and non-blocking: it names the answer and gets out of the
 * way. It is not a confirm dialog — nothing is waiting on it, and no key press
 * is consumed by it.
 */
export default function PlayerConfirm({ userId, name }) {
  if (!name) return null;
  return (
    <div className="player-confirm" role="status" aria-live="polite">
      <div className="player-confirm__card">
        <span className="player-confirm__avatar">
          <ProfileAvatar id={userId} name={name} size={320} />
        </span>
        <span className="player-confirm__name">{name}</span>
        <span className="player-confirm__caption">is playing</span>
      </div>
    </div>
  );
}
