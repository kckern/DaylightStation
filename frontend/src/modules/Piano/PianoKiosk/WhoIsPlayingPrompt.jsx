import { useEffect, useRef, useState, useMemo } from 'react';
import PianoAvatar from './PianoAvatar.jsx';
import { columnsForCount, paginatePlayers } from './whoIsPlayingLayout.js';

/**
 * "Who's playing?" prompt — roster faces ONLY (Guest is never a card). Tap a
 * face → onPick(id). The ✕ / backdrop / timeout → onDismiss (the caller sets
 * the player to Guest). Presentational; the parent owns identity side-effects.
 *
 * Layout: each page of up to 9 faces is balanced into even rows (6→3+3, 8→4+4,
 * 7→4+3 centered) by capping the flex grid to `columnsForCount` columns. A
 * roster larger than 9 paginates, with page dots beneath the grid.
 */
export default function WhoIsPlayingPrompt({ open, users = [], onPick, onDismiss, timeoutMs = 30000 }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const pages = useMemo(() => paginatePlayers(users), [users]);
  const [page, setPage] = useState(0);
  // Keep the active page in range when the roster shrinks.
  useEffect(() => { setPage((p) => Math.min(p, Math.max(0, pages.length - 1))); }, [pages.length]);

  useEffect(() => {
    if (!open || !(timeoutMs > 0)) return undefined;
    const t = setTimeout(() => onDismissRef.current?.(), timeoutMs);
    return () => clearTimeout(t);
  }, [open, timeoutMs]);

  if (!open) return null;
  const current = pages[Math.min(page, Math.max(0, pages.length - 1))] || [];
  const columns = columnsForCount(current.length);
  return (
    <div className="piano-userpicker piano-userpicker--prompt" role="dialog" aria-modal="true" aria-label="Who's playing?">
      <div className="piano-userpicker__scrim" onClick={() => onDismiss?.()} />
      <div className="piano-userpicker__sheet">
        <button type="button" className="piano-userpicker__close" aria-label="Close" onClick={() => onDismiss?.()}>✕</button>
        <h2 className="piano-userpicker__title">Who's playing?</h2>
        <ul
          className="piano-userpicker__grid"
          data-columns={columns}
          style={{ '--picker-cols': columns }}
        >
          {current.map((u) => (
            <li key={u.id}>
              <button type="button" className="piano-usercard" onClick={() => onPick?.(u.id)}>
                <PianoAvatar id={u.id} name={u.name} />
                <span className="piano-usercard__name">{u.name}</span>
                {u.group_label && <span className="piano-usercard__label">{u.group_label}</span>}
              </button>
            </li>
          ))}
        </ul>
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
      </div>
    </div>
  );
}
