/**
 * Presence gate (browser half). While the supervising adult is away — the HA
 * presence entity named in fitness config `presence_gate` reads anything but
 * home — opening a show (`show`) or starting a video (`play`) on the garage
 * kiosk needs an admin fingerprint (IdentityProvider.registerAdmin). One unlock
 * keeps the kiosk open for `unlock_minutes`. Absent/disabled config ⇒ no gate
 * and no presence request. Backend: GET /api/v1/fitness/presence.
 * See __docs/reference/fitness/presence-gate.md.
 *
 * One shared store per page: FitnessShow and FitnessPlayer mount separately but
 * read one presence verdict, one poll and one unlock grant.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { isKioskEnv } from '@/lib/kioskEnv.js';
import getLogger from '@/lib/logging/Logger.js';
import { useFitness } from '../context/FitnessContext.jsx';

let _logger;
const logger = () => (_logger ??= getLogger().child({ component: 'presence-gate' }));

const PRESENCE_URL = '/api/v1/fitness/presence';
const MIN_POLL_MS = 15000;

/** Config → policy. Mirrors the backend normalizer; off unless explicitly enabled with an entity. */
export function normalizePresenceGateConfig(cfg) {
  const entity = typeof cfg?.entity === 'string' && cfg.entity.trim() ? cfg.entity.trim() : null;
  const listed = Array.isArray(cfg?.gate) ? cfg.gate.map((g) => String(g).trim().toLowerCase()) : ['play', 'show'];
  const cacheSeconds = Number(cfg?.cache_seconds) > 0 ? Number(cfg.cache_seconds) : 30;
  return {
    enabled: cfg?.enabled === true && Boolean(entity),
    gate: new Set(listed),
    pollMs: Math.max(MIN_POLL_MS, cacheSeconds * 1000),
    unlockMinutes: Number(cfg?.unlock_minutes) > 0 ? Number(cfg.unlock_minutes) : 30,
  };
}

/**
 * Pure decision. `settled` false means "still asking the server": hold, but
 * don't prompt yet (a prompt that flashes up while the adult is home is noise).
 * @returns {{ required: boolean, settled: boolean, reason: string }}
 */
export function decidePresenceGate({ kind, config, presence, status, grantUntil, now, kiosk }) {
  if (!config?.enabled) return { required: false, settled: true, reason: 'disabled' };
  if (!kiosk) return { required: false, settled: true, reason: 'not-kiosk' };
  if (!config.gate.has(kind)) return { required: false, settled: true, reason: 'not-gated' };
  if (grantUntil > now) return { required: false, settled: true, reason: 'unlocked' };
  if (status === 'idle' || status === 'loading') return { required: true, settled: false, reason: 'checking' };
  if (status === 'error' || !presence || presence.enabled !== true) {
    // Config says on but the server can't (or won't) say — fail closed.
    return { required: true, settled: true, reason: 'sensor_unavailable' };
  }
  if (presence.home === true) return { required: false, settled: true, reason: 'home' };
  return { required: true, settled: true, reason: presence.reason ? 'sensor_unavailable' : 'away' };
}

// ── shared store ────────────────────────────────────────────────────────────
let state = { presence: null, status: 'idle', grantUntil: 0 };
const listeners = new Set();
let pollTimer = null;
let pollMs = null;
let subscribers = 0;
let inflight = null;

const emit = (patch) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export async function refreshPresence() {
  if (inflight) return inflight;
  if (state.status === 'idle') emit({ status: 'loading' });
  inflight = (async () => {
    try {
      const presence = await DaylightAPI(PRESENCE_URL);
      const prev = state.presence;
      emit({ presence, status: 'ready' });
      const changed = !prev || prev.home !== presence?.home || prev.state !== presence?.state;
      (changed ? logger().info : logger().debug)('fitness.presence_gate.checked', {
        home: presence?.home ?? null, state: presence?.state ?? null, reason: presence?.reason ?? null,
        enabled: presence?.enabled ?? null, cached: presence?.cached ?? null,
      });
      if (presence?.enabled && presence.reason) {
        logger().warn('fitness.presence_gate.sensor_unavailable', { state: presence.state ?? null, reason: presence.reason });
      }
    } catch (error) {
      emit({ status: 'error' });
      logger().warn('fitness.presence_gate.sensor_unavailable', { reason: 'fetch-failed', error: error?.message });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

function ensurePolling(ms) {
  if (pollTimer && pollMs === ms) return;
  if (pollTimer) clearInterval(pollTimer);
  pollMs = ms;
  pollTimer = setInterval(() => { refreshPresence(); }, ms);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  pollMs = null;
}

/** Record a granted admin unlock; it keeps every gated entry open for `minutes`. */
export function grantPresenceUnlock(minutes, { userId = null, kind = null } = {}) {
  const until = Date.now() + minutes * 60000;
  emit({ grantUntil: until });
  logger().info('fitness.presence_gate.unlocked', { userId, kind, minutes, until: new Date(until).toISOString() });
}

/** Test seam: reset the module store. */
export function __resetPresenceGateStore() {
  stopPolling();
  subscribers = 0;
  inflight = null;
  state = { presence: null, status: 'idle', grantUntil: 0 };
  listeners.forEach((l) => l());
}

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l); };
const snapshot = () => state;

/**
 * @param {'play'|'show'} kind
 * @returns {{ enabled: boolean, required: boolean, settled: boolean, reason: string, unlockMinutes: number, grant: Function, refresh: Function }}
 */
export default function usePresenceGate(kind) {
  const { fitnessConfiguration } = useFitness() || {};
  const raw = fitnessConfiguration?.fitness?.presence_gate ?? fitnessConfiguration?.presence_gate;
  const config = useMemo(() => normalizePresenceGateConfig(raw), [raw]);
  const store = useSyncExternalStore(subscribe, snapshot, snapshot);
  const kiosk = isKioskEnv();
  const active = config.enabled && kiosk && config.gate.has(kind);

  // Fetch on mount, then poll while any gated surface is mounted.
  useEffect(() => {
    if (!active) return undefined;
    subscribers += 1;
    refreshPresence();
    ensurePolling(config.pollMs);
    return () => {
      subscribers -= 1;
      if (subscribers <= 0) { subscribers = 0; stopPolling(); }
    };
  }, [active, config.pollMs]);

  const decision = decidePresenceGate({
    kind, config, presence: store.presence, status: store.status, grantUntil: store.grantUntil, now: Date.now(), kiosk,
  });

  // A grant that expires while nobody re-renders must still re-close the gate.
  useEffect(() => {
    if (!active || !(store.grantUntil > Date.now())) return undefined;
    const t = setTimeout(() => emit({}), store.grantUntil - Date.now() + 10);
    return () => clearTimeout(t);
  }, [active, store.grantUntil]);

  return {
    enabled: active,
    ...decision,
    unlockMinutes: config.unlockMinutes,
    grant: (meta) => grantPresenceUnlock(config.unlockMinutes, { ...meta, kind }),
    refresh: refreshPresence,
  };
}
