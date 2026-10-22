/**
 * Who is using this device — declared by whichever surface knows (a workout's
 * riders, the child at the reader, the piano's player) and carried on every
 * fleet heartbeat as `snapshot.audience` (registrySessionSource). Declarations
 * stack: the latest live one wins, and withdrawing it reveals the one beneath
 * (a piano game over the piano shell's lesson). Keyed by activity + people, so
 * a roster object that changes every heart-rate tick never re-publishes.
 */
import { useEffect, useRef } from 'react';
import getLogger from '../../../../frontend/src/lib/logging/Logger.js';

let _logger;
const logger = () => (_logger ||= getLogger().child({ component: 'device-audience' }));

export function audienceKey(audience) {
  if (!audience) return '';
  const people = (audience.people || [])
    .map((p) => `${p?.id}|${p?.role}|${p?.guest ? 1 : 0}`)
    .sort()
    .join(',');
  return `${audience.activity}:${people}`;
}

export function createAudienceStore() {
  const entries = []; // [{ token, audience, key }] in declaration order
  const listeners = new Set();
  const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* listener's problem */ } });
  return {
    declare(token, audience) {
      const key = audienceKey(audience);
      const at = entries.findIndex((e) => e.token === token);
      if (at >= 0 && entries[at].key === key) { entries[at].audience = audience; return; }
      if (at >= 0) entries.splice(at, 1);
      entries.push({ token, audience, key });
      logger().debug('device-audience.declared', { activity: audience?.activity, count: audience?.people?.length ?? 0 });
      notify();
    },
    withdraw(token) {
      const at = entries.findIndex((e) => e.token === token);
      if (at < 0) return;
      entries.splice(at, 1);
      logger().debug('device-audience.withdrawn', {});
      notify();
    },
    get() { return entries.length ? entries[entries.length - 1].audience : null; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}

let _store;
export function getDeviceAudienceStore() { return (_store ||= createAudienceStore()); }

let _seq = 0;
export function useDeviceAudience(audience, { store } = {}) {
  const s = store ?? getDeviceAudienceStore();
  const tokenRef = useRef(null);
  if (!tokenRef.current) tokenRef.current = `aud-${++_seq}`;
  const key = audienceKey(audience);
  const latest = useRef(audience);
  latest.current = audience;
  useEffect(() => {
    const token = tokenRef.current;
    if (!key) { s.withdraw(token); return undefined; }
    s.declare(token, latest.current);
    return () => s.withdraw(token);
  }, [key, s]);
}
