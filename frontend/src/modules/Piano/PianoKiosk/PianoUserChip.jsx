import { useState } from 'react';
import { usePianoUser } from './PianoUserContext.jsx';

/** Round avatar — user image, falling back to initials on a colour from the id. */
function Avatar({ id, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) {
    return <span className="piano-avatar piano-avatar--fallback" data-initials={initials}>{initials}</span>;
  }
  return (
    <img
      className="piano-avatar"
      src={`/api/v1/static/img/users/${id}`}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Current-player chip for the chrome. Shows who's playing; tap to open a roster
 * picker ("Who's playing?") and switch. Selecting a user re-scopes recordings,
 * lesson progress, and preferences to them.
 */
export default function PianoUserChip() {
  const { users, currentProfile, currentUser, setCurrentUser } = usePianoUser();
  const [open, setOpen] = useState(false);

  if (!currentProfile && !users.length) return null;
  const label = currentProfile?.group_label || currentProfile?.name || 'Choose player';

  return (
    <>
      <button type="button" className="piano-chrome__user" onClick={() => setOpen(true)} aria-label="Switch player" title={currentProfile?.name || 'Choose player'}>
        <Avatar id={currentProfile?.id} name={currentProfile?.name} />
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
                    <Avatar id={u.id} name={u.name} />
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
