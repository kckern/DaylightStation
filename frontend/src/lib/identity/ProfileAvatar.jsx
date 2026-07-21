import { useState } from 'react';
import './identity.scss';

/** Round avatar — user image, falling back to initials on a colour from the id. */
export default function ProfileAvatar({ id, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) {
    return <span className="piano-avatar piano-avatar--fallback" data-initials={initials}>{initials}</span>;
  }
  return (
    <img className="piano-avatar" src={`/api/v1/static/img/users/${id}`} alt={name} onError={() => setFailed(true)} />
  );
}
