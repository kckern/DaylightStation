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
    // The name counts: the reader learns a child's name after the session
    // opens, and a card stuck on "Someone" is wrong. It changes rarely.
    .map((p) => `${p?.id}|${p?.role}|${p?.guest ? 1 : 0}|${p?.name ?? ''}`)
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
      // A known token keeps its place in the stack: a game declared over the
      // piano shell stays on top even if the shell's player changes meanwhile.
      if (at >= 0) entries[at] = { token, audience, key };
      else entries.push({ token, audience, key });
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
  // Declare (or replace in place) on every key change; withdraw only when the
  // audience goes null or the declarer unmounts — a withdraw-then-declare on
  // each change would re-stack it above a newer, live declaration.
  useEffect(() => {
    const token = tokenRef.current;
    if (!key) s.withdraw(token);
    else s.declare(token, latest.current);
  }, [key, s]);
  useEffect(() => {
    const token = tokenRef.current;
    return () => s.withdraw(token);
  }, [s]);
}
