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
 * one card per player with course history — avatar in a completion ring
 * (same language as the poster chips), course title, relative time. Tap →
 * that course. Renders nothing while loading, on error, or when empty.
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
        const pct = chipPercent(u);
        const stale = chipIsStale(u);
        return (
          <button
            type="button"
            key={u.userId}
            className={`piano-menu-activity__card${stale ? ' is-stale' : ''}`}
            onClick={() => onOpenCourse?.(u.courseId)}
            title={`${u.name}: ${u.completed}/${u.total}`}
          >
            <span className="piano-menu-activity__ring">
              <svg viewBox="0 0 36 36" aria-hidden="true">
                <circle className="piano-menu-activity__ring-track" cx="18" cy="18" r={100 / (2 * Math.PI)} />
                <circle
                  className="piano-menu-activity__ring-fill"
                  cx="18" cy="18" r={100 / (2 * Math.PI)}
                  strokeDasharray={`${pct} 100`}
                  transform="rotate(-90 18 18)"
                />
              </svg>
              <ProfileAvatar id={u.userId} name={u.name} />
            </span>
            <span className="piano-menu-activity__meta">
              <span className="piano-menu-activity__pct">{pct}%</span>
              <span className="piano-menu-activity__course">{u.courseTitle}</span>
              <span className="piano-menu-activity__when">{relativeTime(u.lastPlayedAt)}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
