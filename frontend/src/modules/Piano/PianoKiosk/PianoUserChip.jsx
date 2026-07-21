import { useState, useContext } from 'react';
import PianoUserContext from './PianoUserContext.jsx';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import ProfilePicker from '../../../lib/identity/ProfilePicker.jsx';
import { usePianoPlayback } from './PianoPlaybackContext.jsx';
import { usePianoScreenOff } from './usePianoScreenOff.js';
import LockIcon from '@/modules/Fitness/player/overlays/LockIcon.jsx';

/**
 * Current-player chip for the chrome. Shows who's playing; tap to open the
 * shared ProfilePicker and switch. Selecting a user re-scopes
 * recordings, lesson progress, and preferences to them.
 *
 * Manual switch, so: no auto-dismiss timeout, and dismissing just closes the
 * sheet (unlike the idle-gap re-prompt, where a dismiss means "Guest"). The
 * "Turn off screen" affordance IS shown here too — it's the same screen-off
 * action the idle re-prompt offers, so both entry points expose it.
 *
 * Locked while a video lecture is open: the active player earns watch credit, so
 * switching mid-lesson would mis-credit the watch. The chip stays visible (so you
 * can see who's credited) but is non-interactive until the player is left.
 *
 * Split outer/inner so the throwing hooks (config, screen-off) only run once a
 * PianoUserProvider is present — the chip renders nothing in isolated chrome
 * tests that mount PianoChrome without providers.
 */
export default function PianoUserChip() {
  // Read the context directly (not the throwing usePianoUser) so the chip simply
  // renders nothing when there's no PianoUserProvider (e.g. isolated chrome tests).
  const ctx = useContext(PianoUserContext);
  if (!ctx) return null;
  if (!ctx.currentProfile && !ctx.users.length) return null;
  return <PianoUserChipInner ctx={ctx} />;
}

function PianoUserChipInner({ ctx }) {
  const { videoActive } = usePianoPlayback();
  const screenOff = usePianoScreenOff();
  const [open, setOpen] = useState(false);
  const { users, currentProfile, currentUser, setCurrentUser } = ctx;

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
        <ProfileAvatar id={currentProfile?.id} name={currentProfile?.name} />
        <span className="piano-chrome__username">{label}</span>
        {locked && <span className="piano-chrome__user-lock" aria-hidden="true"><LockIcon /></span>}
      </button>

      <ProfilePicker
        open={open && !locked}
        users={users}
        activeId={currentUser}
        timeoutMs={0}
        onPick={(id) => { setCurrentUser(id); setOpen(false); }}
        onDismiss={() => setOpen(false)}
        onScreenOff={async () => { await screenOff(); setOpen(false); }}
      />
    </>
  );
}
