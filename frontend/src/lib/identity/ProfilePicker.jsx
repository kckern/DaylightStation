import { useEffect, useRef, useState, useMemo } from 'react';
import ProfileAvatar from './ProfileAvatar.jsx';
import { columnsForCount, paginatePlayers } from './profilePickerLayout.js';
import { hasFamilyContext, resolveUserDisplayName } from '@/lib/userDisplayName.js';
import useArmedAction from './useArmedAction.js';
import './identity.scss';

/**
 * "Who's playing?" prompt — roster faces ONLY (Guest is never a card). Tap a
 * face → onPick(id). The ✕ / backdrop / timeout → onDismiss (the caller sets
 * the player to Guest). Presentational; the parent owns identity side-effects.
 *
 * The SINGLE picker for the kiosk: both the idle-gap re-prompt (PianoApp) and
 * the chrome chip's manual switch (PianoUserChip) render this. The two callers
 * differ only in props — the chip marks the current player (`activeId`), skips
 * the auto-dismiss (`timeoutMs={0}`) and omits `onScreenOff`.
 *
 * Layout: a full page is a 3×2 grid of 6 faces (columnsForCount(6) → 3 columns);
 * a smaller trailing page balances into even rows (5→3+2) by capping the flex
 * grid to `columnsForCount` columns. A roster larger than 6 paginates, with page
 * dots beneath the grid.
 *
 * Guest button (opt-in, School): both `guestLabel` and `onGuest` must be set
 * for the row to render — Piano never passes either, so its picker is
 * unchanged. When present, it's a THIRD affordance alongside a face and the
 * ✕: a face claims, the ✕ cancels (leaves things as they were), and this
 * button is the only way to explicitly become Guest.
 */
export default function ProfilePicker({ open, users = [], activeId, onPick, onDismiss, onScreenOff, guestLabel, onGuest, timeoutMs = 30000, title = "Who's playing?", showCountdown = false }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Optional "Turn off screen" affordance for someone who doesn't want the
  // tablet involved. Two-tap arm/confirm so a stray tap can't blank the screen.
  const { armed: offArmed, trigger: triggerOff } = useArmedAction(() => onScreenOff?.(), { armMs: 3000 });

  // A roster that lists the kids is a "family scene" → show relational labels
  // (Dad/Mom) for the parents; adults-only → full names. Derived once from the
  // whole roster so it's stable across pages.
  const familyContext = useMemo(() => hasFamilyContext(users), [users]);
  const pages = useMemo(() => paginatePlayers(users), [users]);
  const [page, setPage] = useState(0);
  // Keep the active page in range when the roster shrinks.
  useEffect(() => { setPage((p) => Math.min(p, Math.max(0, pages.length - 1))); }, [pages.length]);

  // Any interaction inside the sheet restarts the auto-dismiss countdown —
  // browsing pages must not eat the timeout budget and land on a surprise
  // Guest dismiss (audit F9).
  const [interactionEpoch, setInteractionEpoch] = useState(0);

  useEffect(() => {
    if (!open || !(timeoutMs > 0)) return undefined;
    const t = setTimeout(() => onDismissRef.current?.(), timeoutMs);
    return () => clearTimeout(t);
  }, [open, timeoutMs, interactionEpoch]);

  // Opt-in visible countdown (school advocacy: an auto-dismiss a child can
  // SEE coming is a rule; one that fires from silence is a trick). Ticks a
  // once-a-second display; any interaction resets it with the timer above.
  const [secondsLeft, setSecondsLeft] = useState(null);
  useEffect(() => {
    if (!open || !showCountdown || !(timeoutMs > 0)) { setSecondsLeft(null); return undefined; }
    setSecondsLeft(Math.round(timeoutMs / 1000));
    const iv = setInterval(() => setSecondsLeft((n) => (n !== null && n > 0 ? n - 1 : n)), 1000);
    return () => clearInterval(iv);
  }, [open, showCountdown, timeoutMs, interactionEpoch]);

  if (!open) return null;
  const current = pages[Math.min(page, Math.max(0, pages.length - 1))] || [];
  const columns = columnsForCount(current.length);
  return (
    <div className="piano-userpicker piano-userpicker--prompt" role="dialog" aria-modal="true" aria-label={title}>
      <div className="piano-userpicker__scrim" onClick={() => onDismiss?.()} />
      <div className="piano-userpicker__sheet" onPointerDown={() => setInteractionEpoch((e) => e + 1)}>
        <button type="button" className="piano-userpicker__close" aria-label="Close" onClick={() => onDismiss?.()}>✕</button>
        <h2 className="piano-userpicker__title">{title}</h2>
        {showCountdown && secondsLeft !== null && secondsLeft <= 10 && (
          <p className="piano-userpicker__countdown" data-testid="picker-countdown" aria-live="polite">
            Closing in {secondsLeft}…
          </p>
        )}
        <ul
          className="piano-userpicker__grid"
          data-columns={columns}
          style={{ '--picker-cols': columns }}
        >
          {current.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={`piano-usercard${u.id === activeId ? ' is-active' : ''}`}
                aria-pressed={activeId ? u.id === activeId : undefined}
                onClick={() => onPick?.(u.id)}
              >
                {/* Big picker faces (4.5rem + DPR/canvas scaling) need a larger
                    resized variant than the 96px default. */}
                <ProfileAvatar id={u.id} name={u.name} size={192} />
                <span className="piano-usercard__name">{resolveUserDisplayName(u, { familyContext }).displayName}</span>
              </button>
            </li>
          ))}
        </ul>
        {guestLabel && onGuest && (
          <div className="piano-userpicker__guest-row">
            <button type="button" className="piano-userpicker__guest" onClick={() => onGuest()}>
              {guestLabel}
            </button>
          </div>
        )}
        {pages.length > 1 && (
          <div className="piano-userpicker__dots" role="tablist" aria-label="Player pages">
            {pages.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === page}
                aria-label={`Page ${i + 1}`}
                className={`piano-userpicker__dot${i === page ? ' is-active' : ''}`}
                onClick={() => setPage(i)}
              />
            ))}
          </div>
        )}
        {onScreenOff && (
          <div className="piano-userpicker__device">
            <button
              type="button"
              className={`piano-userpicker__screen-off${offArmed ? ' is-armed' : ''}`}
              aria-live="polite"
              onClick={triggerOff}
            >
              {offArmed ? 'Tap again to confirm' : 'Turn off screen'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
