import React from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';

// Per-rider episode history: the avatar used across the show screen and the
// stack on a grid tile's "done" chip. Data shaping (who is credited) lives in
// ../lib/episodeHistory.js; the panel's rows are in EpisodePanel.jsx.

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
