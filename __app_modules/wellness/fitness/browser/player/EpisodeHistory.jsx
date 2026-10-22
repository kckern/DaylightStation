import React from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';

// Per-rider episode history: the avatar stack on a grid tile's "done" chip,
// and the quiet session list under an episode's description. Data shaping
// (who is credited) lives in ../lib/episodeHistory.js.

const FALLBACK_AVATAR = '/static/img/users/user';

export const RiderAvatar = ({ rider, className = '' }) => (
  <img
    className={`episode-rider-avatar ${className}`.trim()}
    src={DaylightMediaPath(`/static/img/users/${rider.id}`)}
    alt=""
    title={rider.displayName || rider.id}
    onError={(event) => {
      const img = event.currentTarget;
      if (img.dataset.fallback) return;
      img.dataset.fallback = '1';
      img.src = DaylightMediaPath(FALLBACK_AVATAR);
    }}
  />
);

export const RiderStack = ({ riders, overflow = 0 }) => (
  <span className="episode-rider-stack">
    {riders.map((rider) => <RiderAvatar key={rider.id} rider={rider} />)}
    {overflow > 0 ? <span className="episode-rider-overflow">+{overflow}</span> : null}
  </span>
);

const rowStats = (riders) => {
  const minutes = Math.max(0, ...riders.map((r) => (Number.isFinite(r.minutes) ? r.minutes : 0)));
  const parts = [];
  if (minutes > 0) parts.push(`${Math.round(minutes)} min`);
  // Rings are per rider, so a shared row would have to pick one — show them
  // only when the row is one person.
  if (riders.length === 1 && Number.isFinite(riders[0].rings) && riders[0].rings > 0) {
    parts.push(`${riders[0].rings} rings`);
  }
  return parts;
};

export const EpisodeHistoryList = ({ rows, formatDate }) => {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return (
    <ul className="episode-history" data-testid="episode-history">
      {rows.map((row) => (
        <li key={row.sessionId} className="episode-history__row">
          <RiderStack riders={row.riders} />
          <span className="episode-history__text">
            {[formatDate(row.startTime), ...rowStats(row.riders)].filter(Boolean).join(' · ')}
          </span>
        </li>
      ))}
    </ul>
  );
};
