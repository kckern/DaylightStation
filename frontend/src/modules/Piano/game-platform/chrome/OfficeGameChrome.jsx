import ProfileAvatar from '../../../../lib/identity/ProfileAvatar.jsx';
import Icon from '../../ui/icons/Icon.jsx';
import './OfficeGameChrome.scss';

/**
 * The what and the who, for a game running on the office screen.
 *
 * The kiosk has a breadcrumb rail naming the mode and a chip naming the player;
 * PianoVisualizer has neither, so a game there opened into a board with no
 * indication of what it was or whose it was. On a wall screen someone walks past
 * — rather than a tablet they are holding — that is the first thing a viewer
 * needs and the last thing the board itself can tell them.
 *
 * Deliberately thin and out of the way: the board is the content. This names the
 * two facts the screen cannot otherwise supply and then gets out of the frame.
 */
export default function OfficeGameChrome({ label, icon = null, playerName = null, playerId = null }) {
  if (!label) return null;
  return (
    <header className="office-game-chrome">
      <span className="office-game-chrome__what">
        {icon && <Icon name={icon} className="office-game-chrome__icon" />}
        <span className="office-game-chrome__title">{label}</span>
      </span>

      {/* No player is a real state worth showing, not a blank: a game filed
          under nobody is how a record ends up belonging to no one. */}
      <span className="office-game-chrome__who">
        {playerName ? (
          <>
            <span className="office-game-chrome__avatar">
              <ProfileAvatar id={playerId} name={playerName} size={96} />
            </span>
            <span className="office-game-chrome__name">{playerName}</span>
          </>
        ) : (
          <span className="office-game-chrome__name office-game-chrome__name--none">No player</span>
        )}
      </span>
    </header>
  );
}
