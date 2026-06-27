import { useState, useContext } from 'react';
import PianoUserContext from './PianoUserContext.jsx';
import PianoAvatar from './PianoAvatar.jsx';
import { usePianoPlayback } from './PianoPlaybackContext.jsx';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

/**
 * Current-player chip for the chrome. Shows who's playing; tap to open a roster
 * picker ("Who's playing?") and switch. Selecting a user re-scopes recordings,
 * lesson progress, and preferences to them.
 *
 * Locked while a video lecture is open: the active player earns watch credit, so
 * switching mid-lesson would mis-credit the watch. The chip stays visible (so you
 * can see who's credited) but is non-interactive until the player is left.
 */
export default function PianoUserChip() {
  // Read the context directly (not the throwing usePianoUser) so the chip simply
  // renders nothing when there's no PianoUserProvider (e.g. isolated chrome tests).
  const ctx = useContext(PianoUserContext);
  const { videoActive } = usePianoPlayback();
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  const { users, currentProfile, currentUser, setCurrentUser } = ctx;

  if (!currentProfile && !users.length) return null;
  const label = currentProfile?.group_label || currentProfile?.name || 'Choose player';
  const locked = !!videoActive;

  return (
    <>
      <button
        type="button"
        className={`piano-chrome__user${locked ? ' piano-chrome__user--locked' : ''}`}
        onClick={() => { if (!locked) setOpen(true); }}
        disabled={locked}
        aria-disabled={locked}
        aria-label={locked ? 'Player locked during lesson' : 'Switch player'}
        title={locked ? 'Finish the lesson to switch players' : (currentProfile?.name || 'Choose player')}
      >
        <PianoAvatar id={currentProfile?.id} name={currentProfile?.name} />
        <span className="piano-chrome__username">{label}</span>
        {locked && <span className="piano-chrome__user-lock" aria-hidden="true"><LockIcon /></span>}
      </button>

      {open && !locked && (
        <div className="piano-userpicker" role="dialog" aria-modal="true" aria-label="Choose player">
          <div className="piano-userpicker__scrim" onClick={() => setOpen(false)} />
          <div className="piano-userpicker__sheet">
            <h2 className="piano-userpicker__title">Who’s playing?</h2>
            <ul className="piano-userpicker__grid">
              {users.map((u) => (
                <li key={u.id}>
                  <button
                    type="button"
                    className={`piano-usercard${u.id === currentUser ? ' is-active' : ''}`}
                    onClick={() => { setCurrentUser(u.id); setOpen(false); }}
                    aria-pressed={u.id === currentUser}
                  >
                    <PianoAvatar id={u.id} name={u.name} />
                    <span className="piano-usercard__name">{u.name}</span>
                    {u.group_label && <span className="piano-usercard__label">{u.group_label}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
