import { useState, useContext } from 'react';
import PianoUserContext from './PianoUserContext.jsx';
import PianoAvatar from './PianoAvatar.jsx';

/**
 * Current-player chip for the chrome. Shows who's playing; tap to open a roster
 * picker ("Who's playing?") and switch. Selecting a user re-scopes recordings,
 * lesson progress, and preferences to them.
 */
export default function PianoUserChip() {
  // Read the context directly (not the throwing usePianoUser) so the chip simply
  // renders nothing when there's no PianoUserProvider (e.g. isolated chrome tests).
  const ctx = useContext(PianoUserContext);
  const [open, setOpen] = useState(false);
  if (!ctx) return null;
  const { users, currentProfile, currentUser, setCurrentUser } = ctx;

  if (!currentProfile && !users.length) return null;
  const label = currentProfile?.group_label || currentProfile?.name || 'Choose player';

  return (
    <>
      <button type="button" className="piano-chrome__user" onClick={() => setOpen(true)} aria-label="Switch player" title={currentProfile?.name || 'Choose player'}>
        <PianoAvatar id={currentProfile?.id} name={currentProfile?.name} />
        <span className="piano-chrome__username">{label}</span>
      </button>

      {open && (
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
