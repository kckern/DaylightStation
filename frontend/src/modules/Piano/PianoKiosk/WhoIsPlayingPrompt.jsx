import { useEffect, useRef } from 'react';
import PianoAvatar from './PianoAvatar.jsx';

/**
 * "Who's playing?" prompt — roster faces ONLY (Guest is never a card). Tap a
 * face → onPick(id). The ✕ / backdrop / timeout → onDismiss (the caller sets
 * the player to Guest). Presentational; the parent owns identity side-effects.
 */
export default function WhoIsPlayingPrompt({ open, users = [], onPick, onDismiss, timeoutMs = 30000 }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!open || !(timeoutMs > 0)) return undefined;
    const t = setTimeout(() => onDismissRef.current?.(), timeoutMs);
    return () => clearTimeout(t);
  }, [open, timeoutMs]);

  if (!open) return null;
  return (
    <div className="piano-userpicker piano-userpicker--prompt" role="dialog" aria-modal="true" aria-label="Who's playing?">
      <div className="piano-userpicker__scrim" onClick={() => onDismiss?.()} />
      <div className="piano-userpicker__sheet">
        <button type="button" className="piano-userpicker__close" aria-label="Close" onClick={() => onDismiss?.()}>✕</button>
        <h2 className="piano-userpicker__title">Who's playing?</h2>
        <ul className="piano-userpicker__grid">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className="piano-usercard" onClick={() => onPick?.(u.id)}>
                <PianoAvatar id={u.id} name={u.name} />
                <span className="piano-usercard__name">{u.name}</span>
                {u.group_label && <span className="piano-usercard__label">{u.group_label}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
