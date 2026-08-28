import { useEffect, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import ProfileAvatar from '../../../lib/identity/ProfileAvatar.jsx';
import { chipPercent, chipIsStale } from './modes/Videos/courseChipModel.js';
import usePianoList from './usePianoList.js';
import Skeleton from './Skeleton.jsx';
import { relativeTime, readShape, writeShape } from './pianoMenuActivityModel.js';

const ACTIVITY_PATH = 'api/v1/piano/activity/recent';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'piano-menu-activity' });
  return _logger;
}

// Request a right-sized, server-side-scaled thumbnail (proxy `?w=&h=` →
// Plex photo transcoder) instead of downscaling a full poster in the browser.
const THUMB_W = 140;
const THUMB_H = 200;
const sizedThumb = (url) => (url ? `${url}${url.includes('?') ? '&' : '?'}w=${THUMB_W}&h=${THUMB_H}` : url);

/**
 * Loading placeholder: the strip's own silhouette (same container, same card
 * chrome, same poster boxes) so the real strip swaps in without moving
 * anything. Reserves nothing when the last visit had no players.
 */
export function ActivitySkeleton({ shape }) {
  if (!shape.length) return null;
  return (
    <div className="piano-menu-activity piano-menu-activity--skeleton" aria-hidden="true">
      {shape.map((courses, i) => (
        <div className="piano-menu-activity__card" key={i}>
          <span className="piano-menu-activity__who">
            <Skeleton className="piano-menu-activity__skel-avatar" />
            <Skeleton className="piano-menu-activity__skel-when" />
          </span>
          {Array.from({ length: courses }, (_, j) => (
            <Skeleton key={j} className="piano-menu-activity__skel-poster" />
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * Menu course-activity strip (spec 2026-07-28-piano-menu-activity-strip):
 * one card per player with course history — avatar + up to four recent-course
 * poster thumbnails, each with its completion percent underneath (same
 * percent rule as the poster chips). Tap a thumbnail → that course. Players
 * idle past the fresh window dim. Renders its own skeleton silhouette while
 * loading; renders nothing on error or when empty.
 *
 * Data comes through the shared stale-while-revalidate list cache, so a warm
 * kiosk paints the previous strip immediately and repaints only if the server
 * disagrees.
 *
 * `disabled` greys the whole strip out and blocks the course buttons — the menu
 * passes it under curfew, when every door out of the home screen is shut.
 */
export default function PianoMenuActivity({ onOpenCourse, disabled }) {
  const { data: players, loading } = usePianoList(
    ACTIVITY_PATH,
    (r) => (Array.isArray(r?.players) ? r.players : []),
  );
  // Read once, at first paint — a later write must not resize a live skeleton.
  const [shape] = useState(readShape);

  useEffect(() => { if (players) writeShape(players); }, [players]);
  useEffect(() => {
    if (loading) logger().debug('piano.menu-activity.reserving', { cards: shape.length, shape });
  }, [loading, shape]);

  if (loading) return <ActivitySkeleton shape={shape} />;
  if (!players.length) return null;
  return (
    <div
      className={`piano-menu-activity${disabled ? ' is-disabled' : ''}`}
      aria-label="Recent course activity"
    >
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
                  disabled={disabled}
                  aria-disabled={disabled || undefined}
                  onClick={disabled ? undefined : () => onOpenCourse?.(c.courseId, u.userId)}
                  title={`${u.name} — ${c.courseTitle}: ${c.completed}/${c.total}`}
                >
                  <span className="piano-menu-activity__poster">
                    {c.thumbnail ? (
                      <img
                        className="piano-menu-activity__thumb"
                        src={sizedThumb(c.thumbnail)}
                        alt={c.courseTitle}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="piano-menu-activity__thumb piano-menu-activity__thumb--fallback">
                        {c.courseTitle}
                      </span>
                    )}
                    {/* Bottom gradient overlay: percent + per-season dots
                        (filled=done, blinking=in progress, empty=to do). */}
                    <span className="piano-menu-activity__overlay">
                      <span className="piano-menu-activity__course-pct">{pct}%</span>
                      {Array.isArray(c.units) && c.units.length > 1 && (
                        <span
                          className={`piano-menu-activity__units${c.units.length > 16 ? ' piano-menu-activity__units--dense' : ''}`}
                          aria-hidden="true"
                        >
                          {c.units.map((s, i) => (
                            <i key={i} className={`piano-menu-activity__unit is-${s}`} />
                          ))}
                        </span>
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
