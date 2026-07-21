import { useState } from 'react';
import ProfileAvatar from '../../../../../lib/identity/ProfileAvatar.jsx';

/**
 * One course/poster tile. The cover loads lazily and starts blurred
 * (`is-loading`); on load it un-blurs and fades in, so covers appear
 * progressively instead of all-at-once. Covers are cached by the display
 * redirect (see display.mjs Cache-Control), so revisits are instant.
 *
 * `progress` (optional) drives two sequential-course adornments:
 *   - a top-left "sequential" badge when `progress.isSequential`
 *   - a bottom gradient overlay with one avatar chip (completed/total) per
 *     qualifying user (already filtered/sorted by the caller) when
 *     `progress.users` is non-empty. Both sit inside the poster box and never
 *     change its size.
 */
export default function CourseTile({ item, onSelect, progress = null }) {
  const [loaded, setLoaded] = useState(false);
  const src = item.thumbnail || item.image;
  const isSequential = !!progress?.isSequential;
  const users = Array.isArray(progress?.users) ? progress.users : [];
  return (
    <li>
      <button type="button" className="piano-video-grid__tile" onClick={() => onSelect(item)} title={item.title}>
        {src && (
          <img
            src={src}
            alt={item.title}
            loading="lazy"
            decoding="async"
            className={`piano-cover${loaded ? '' : ' is-loading'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        )}
        {isSequential && (
          <span className="piano-cover-badge" role="img" aria-label="Sequential course" title="Sequential course">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              {/* Ascending steps — "work through this in order". */}
              <path d="M4 19h4v-4H4v4Zm6 0h4v-8h-4v8Zm6 0h4V7h-4v12Z" fill="currentColor" />
            </svg>
          </span>
        )}
        {users.length > 0 && (
          <div className="piano-cover-progress" aria-label="Player progress">
            {users.map((u) => (
              <span key={u.id} className="piano-cover-progress__chip" title={`${u.name}: ${u.completed}/${u.total}`}>
                <ProfileAvatar id={u.id} name={u.name} />
                <span className="piano-cover-progress__count">{u.completed}/{u.total}</span>
              </span>
            ))}
          </div>
        )}
      </button>
    </li>
  );
}
