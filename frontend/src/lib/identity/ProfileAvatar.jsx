import { useState } from 'react';
import './identity.scss';

/**
 * Round avatar — user image, falling back to initials on a colour from the id.
 * Requests a server-resized variant (`?w=`, static router) — avatars render at
 * ~2.5rem, so shipping the full-resolution portrait wastes bandwidth and
 * aliases on the downscale. `size` is the requested pixel width (2× the
 * largest on-screen use).
 */
export default function ProfileAvatar({ id, name, size = 96 }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) {
    return <span className="piano-avatar piano-avatar--fallback" data-initials={initials}>{initials}</span>;
  }
  return (
    <img
      className="piano-avatar"
      src={`/api/v1/static/img/users/${id}?w=${size}`}
      alt={name}
      onError={() => setFailed(true)}
    />
  );
}
