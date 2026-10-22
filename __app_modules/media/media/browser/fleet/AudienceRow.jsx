/**
 * Who is using a device, from its heartbeat's `snapshot.audience`: up to four
 * small avatars and a short label. Guests are never named.
 */
import React from 'react';
import { DaylightMediaPath } from '@/lib/api.mjs';

const MAX = 4;
const nameOf = (p) => (p.guest ? 'Guest' : (p.name || 'Someone'));

export function audienceLabel(people) {
  if (!people.length) return '';
  const first = nameOf(people[0]);
  const rest = people.length - 1;
  return rest ? `${first} & ${rest} other${rest > 1 ? 's' : ''}` : first;
}

export default function AudienceRow({ audience, deviceId }) {
  const people = (audience?.people || []).filter((p) => p && typeof p.id === 'string' && p.id);
  if (!people.length) return null;
  const shown = people.slice(0, MAX);
  return (
    <div className="fleet-card-audience" data-testid={`fleet-audience-${deviceId}`}>
      <span className="fleet-card-audience__faces">
        {shown.map((p) => (
          <img key={p.id} alt="" title={nameOf(p)}
            src={DaylightMediaPath(p.guest ? '/static/img/users/user' : `/static/img/users/${p.id}`)}
            onError={(e) => { const img = e.currentTarget; if (img.dataset.fallback) return; img.dataset.fallback = '1'; img.src = DaylightMediaPath('/static/img/users/user'); }} />
        ))}
        {people.length > MAX ? <span className="fleet-card-audience__more">+{people.length - MAX}</span> : null}
      </span>
      <span className="fleet-card-audience__label">{audienceLabel(people)}</span>
    </div>
  );
}
