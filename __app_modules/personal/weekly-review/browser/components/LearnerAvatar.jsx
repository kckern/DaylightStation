// A child's face, from the household's user photos (/static/img/users/<id>),
// ringed in the child's hue. The URL comes from the learner id alone, so every
// child with a photo gets it without any stored avatar field. Only when the
// photo truly fails to load does it fall back to the first letter of the name.
import React, { useState } from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

let _l;
const logger = () => (_l ||= getLogger().child({ component: 'weekly-review-learner-avatar' }));

// `size` asks the static router for a resized copy (pixel width, about twice
// the largest on-screen size); the full portrait is far bigger than needed.
export function learnerAvatarUrl(learnerId, size) {
  if (!learnerId) return null;
  const url = DaylightMediaPath(`/static/img/users/${encodeURIComponent(learnerId)}`);
  return size ? `${url}?w=${size}` : url;
}

export default function LearnerAvatar({ learnerId, name, className, size = 192 }) {
  const [failed, setFailed] = useState(false);
  const src = learnerAvatarUrl(learnerId, size);
  const cls = ['learner-avatar', className].filter(Boolean).join(' ');
  if (!src || failed) {
    return (
      <span className={`${cls} learner-avatar--fallback`} aria-hidden="true">
        {(name || '?').trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      key={src}
      className={cls}
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => {
        logger().debug('avatar.load-failed', { learnerId });
        setFailed(true);
      }}
    />
  );
}
