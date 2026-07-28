import { useEffect, useState } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import getLogger from '../../../lib/logging/Logger.js';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { chipPercent, chipIsStale } from './modes/Videos/CourseTile.jsx';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-menu-activity' });
  return _logger;
}

/** "just now" / "Nm ago" / "Nh ago" / "Nd ago" — coarse by design. */
export function relativeTime(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const mins = Math.floor(Math.max(0, now - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Menu course-activity strip (spec 2026-07-28-piano-menu-activity-strip):
 * one card per player with course history — avatar + up to four recent-course
 * poster thumbnails, each with its completion percent underneath (same
 * percent rule as the poster chips). Tap a thumbnail → that course. Players
 * idle past the fresh window dim. Renders nothing while loading, on error,
 * or when empty.
 */
export default function PianoMenuActivity({ onOpenCourse }) {
  const [players, setPlayers] = useState(null);

  useEffect(() => {
    let cancelled = false;
    DaylightAPI('api/v1/piano/activity/recent')
      .then((r) => { if (!cancelled) setPlayers(Array.isArray(r?.players) ? r.players : []); })
      .catch((e) => {
        if (!cancelled) setPlayers([]);
        logger().warn('piano.menu-activity.load-failed', { error: e?.message });
      });
    return () => { cancelled = true; };
  }, []);

  if (!players?.length) return null;
  return (
    <div className="piano-menu-activity" aria-label="Recent course activity">
      {players.map((u) => {
        const stale = chipIsStale(u); // player-level: keyed off their newest course
        return (
          <div
            key={u.userId}
            className={`piano-menu-activity__card${stale ? ' is-stale' : ''}`}
          >
            <span className="piano-menu-activity__who" title={u.name}>
              <ProfileAvatar id={u.userId} name={u.name} />
              <span className="piano-menu-activity__when">{relativeTime(u.lastPlayedAt)}</span>
            </span>
            {(u.courses || []).map((c) => {
              const pct = chipPercent(c);
              return (
                <button
                  type="button"
                  key={c.courseId}
                  className="piano-menu-activity__course"
                  onClick={() => onOpenCourse?.(c.courseId, u.userId)}
                  title={`${u.name} — ${c.courseTitle}: ${c.completed}/${c.total}`}
                >
                  {c.thumbnail ? (
                    <img
                      className="piano-menu-activity__thumb"
                      src={c.thumbnail}
                      alt={c.courseTitle}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <span className="piano-menu-activity__thumb piano-menu-activity__thumb--fallback">
                      {c.courseTitle}
                    </span>
                  )}
                  <span className="piano-menu-activity__course-pct">{pct}%</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
