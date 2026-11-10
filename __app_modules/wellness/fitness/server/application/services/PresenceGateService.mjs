/**
 * Presence gate — is the supervising adult home?
 *
 * Reads one Home Assistant presence entity (named ONLY in the household fitness
 * config, never here) through the home-automation gateway, so the garage kiosk
 * can require an admin fingerprint to open a show or start a video while that
 * adult is away. See __docs/reference/fitness/presence-gate.md.
 *
 *   presence_gate:
 *     enabled: true            # absent / false ⇒ gate off, Home Assistant never queried
 *     entity: <presence entity>
 *     cache_seconds: 30        # one HA read per window, shared by every caller
 *     gate: [play, show]       # which entries the kiosk gates while away
 *     unlock_minutes: 30       # how long one admin unlock keeps the kiosk open
 *
 * Fails closed: only an explicit home state (`on` / `home`) counts as home.
 * `off`, `unknown`, `unavailable`, an unreadable entity or a missing gateway all
 * read as away — "I could not tell whether he is home" is not "he is home".
 */

const HOME_STATES = new Set(['on', 'home']);
const GATE_KINDS = new Set(['play', 'show']);
const DEFAULT_CACHE_SECONDS = 30;
const DEFAULT_UNLOCK_MINUTES = 30;

const positive = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);

/** @returns {{ enabled: boolean, entity: string|null, cacheMs: number, gate: string[], unlockMinutes: number }} */
export function normalizePresenceGateConfig(cfg) {
  const entity = typeof cfg?.entity === 'string' && cfg.entity.trim() ? cfg.entity.trim() : null;
  const listed = Array.isArray(cfg?.gate) ? cfg.gate.map((g) => String(g).trim().toLowerCase()) : ['play', 'show'];
  return {
    // Enabled only when explicitly switched on AND an entity is named.
    enabled: cfg?.enabled === true && Boolean(entity),
    entity,
    cacheMs: positive(cfg?.cache_seconds, DEFAULT_CACHE_SECONDS) * 1000,
    gate: [...new Set(listed.filter((g) => GATE_KINDS.has(g)))],
    unlockMinutes: positive(cfg?.unlock_minutes, DEFAULT_UNLOCK_MINUTES),
  };
}

export class PresenceGateService {
  #gateway; #loadConfig; #now; #logger; #cache = null; #inflight = null;

  constructor({ gateway = null, loadConfig = () => ({}), now = () => Date.now(), logger = null } = {}) {
    this.#gateway = gateway;
    this.#loadConfig = loadConfig;
    this.#now = now;
    this.#logger = logger;
  }

  /** Current presence verdict. Never throws. */
  async status() {
    const cfg = normalizePresenceGateConfig(this.#loadConfig()?.presence_gate);
    if (!cfg.enabled) return { enabled: false };

    const at = this.#now();
    if (this.#cache && this.#cache.entity === cfg.entity && at - this.#cache.at < cfg.cacheMs) {
      return this.#verdict(cfg, this.#cache, true);
    }
    // Concurrent callers inside one window share a single HA read.
    if (!this.#inflight) {
      this.#inflight = this.#read(cfg.entity).finally(() => { this.#inflight = null; });
    }
    const reading = await this.#inflight;
    this.#cache = { ...reading, entity: cfg.entity, at };
    return this.#verdict(cfg, this.#cache, false);
  }

  async #read(entity) {
    if (typeof this.#gateway?.getState !== 'function') {
      this.#logger?.warn?.('fitness.presence_gate.sensor_unavailable', { reason: 'no_gateway' });
      return { state: null, reason: 'no_gateway' };
    }
    try {
      const result = await this.#gateway.getState(entity);
      const state = typeof result?.state === 'string' ? result.state : null;
      if (!state) {
        this.#logger?.warn?.('fitness.presence_gate.sensor_unavailable', { reason: 'unreadable' });
        return { state: null, reason: 'unreadable' };
      }
      if (!HOME_STATES.has(state) && state !== 'off' && state !== 'not_home') {
        this.#logger?.warn?.('fitness.presence_gate.sensor_unavailable', { reason: 'state', state });
        return { state, reason: 'unavailable' };
      }
      return { state, reason: null };
    } catch (error) {
      this.#logger?.warn?.('fitness.presence_gate.sensor_unavailable', { reason: 'error', error: error?.message });
      return { state: null, reason: 'error' };
    }
  }

  #verdict(cfg, reading, cached) {
    return {
      enabled: true,
      home: HOME_STATES.has(reading.state),
      state: reading.state,
      reason: reading.reason,
      gate: cfg.gate,
      unlockMinutes: cfg.unlockMinutes,
      checkedAt: new Date(reading.at).toISOString(),
      cached,
    };
  }
}

export default PresenceGateService;
