import { useState } from 'react';
import ProfileAvatar from '../../../../../lib/identity/ProfileAvatar.jsx';

// Chips for players idle longer than this dim (the server's recency window is
// far wider — piano.yml progress_overlay.recency_days — so "still shown but
// visibly resting" is the middle state between fresh and gone).
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;

// r chosen so the circumference is exactly 100 units — strokeDasharray can
// then take the percent directly.
const RING_R = 100 / (2 * Math.PI);

/**
 * Completion percent for a chip: prefers a server-computed `percent` (the
 * activity endpoint's season-weighted metric doesn't equal completed/total),
 * else derives from counts. Floors at 1% once anything is completed.
 */
export function chipPercent(u) {
  const server = Number(u?.percent);
  if (Number.isFinite(server) && u?.percent != null) return Math.max(0, Math.min(100, Math.round(server)));
  const total = Number(u?.total) || 0;
  const completed = Number(u?.completed) || 0;
  if (!total || !completed) return 0;
  return Math.max(1, Math.round((completed / total) * 100));
}

/** True when the player's last activity is older than the fresh window. */
export function chipIsStale(u, now = Date.now()) {
  const t = Date.parse(u?.lastPlayedAt || '');
  return Number.isFinite(t) && now - t > FRESH_MS;
}

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
        {/* One positioned box holds the poster AND its overlays: the one-page
            wall letterboxes a fixed 2:3 poster inside a variable cell, and the
            badge/chips must ride the poster's corners, not the cell's. */}
        <span className="piano-cover-box">
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
            {users.map((u) => {
              const pct = chipPercent(u);
              const stale = chipIsStale(u);
              return (
                <span
                  key={u.id}
                  className={`piano-cover-progress__chip${stale ? ' is-stale' : ''}`}
                  title={`${u.name || u.id}: ${u.completed}/${u.total}${stale ? ' (resting)' : ''}`}
                >
                  <span className="piano-cover-progress__ring">
                    <svg viewBox="0 0 36 36" aria-hidden="true">
                      <circle className="piano-cover-progress__ring-track" cx="18" cy="18" r={RING_R} />
                      <circle
                        className="piano-cover-progress__ring-fill"
                        cx="18" cy="18" r={RING_R}
                        strokeDasharray={`${pct} 100`}
                        transform="rotate(-90 18 18)"
                      />
                    </svg>
                    <ProfileAvatar id={u.id} name={u.name} />
                  </span>
                  <span className="piano-cover-progress__pct">{pct}%</span>
                </span>
              );
            })}
          </div>
        )}
        </span>
      </button>
    </li>
  );
}
