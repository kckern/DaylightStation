import { useState, useContext } from 'react';
import PianoUserContext from './PianoUserContext.jsx';
import PianoAvatar from './PianoAvatar.jsx';
import WhoIsPlayingPrompt from './WhoIsPlayingPrompt.jsx';
import { usePianoPlayback } from './PianoPlaybackContext.jsx';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

/**
 * Current-player chip for the chrome. Shows who's playing; tap to open the
 * shared WhoIsPlayingPrompt picker and switch. Selecting a user re-scopes
 * recordings, lesson progress, and preferences to them.
 *
 * Manual switch, so: no auto-dismiss timeout, and dismissing just closes the
 * sheet (unlike the idle-gap re-prompt, where a dismiss means "Guest").
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

      <WhoIsPlayingPrompt
        open={open && !locked}
        users={users}
        activeId={currentUser}
        timeoutMs={0}
        onPick={(id) => { setCurrentUser(id); setOpen(false); }}
        onDismiss={() => setOpen(false)}
      />
    </>
  );
}
