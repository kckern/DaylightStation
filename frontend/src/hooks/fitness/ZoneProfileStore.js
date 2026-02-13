import { deriveZoneProgressSnapshot, getZoneMin } from './types.js';
import getLogger from '../../lib/logging/Logger.js';

const cloneZoneConfig = (config = []) => {
  if (!Array.isArray(config)) return [];
  return config.map((zone, index) => ({
    id: zone?.id ?? zone?.name ?? `zone-${index}`,
    name: zone?.name ?? zone?.id ?? `Zone ${index + 1}`,
    color: zone?.color || null,
    min: Number.isFinite(zone?.min) ? zone.min : null,
    // Preserve coins field for TreasureBox configuration
    coins: Number.isFinite(zone?.coins) ? zone.coins : 0
  }));
};

const cloneZoneSequence = (sequence) => {
  if (!Array.isArray(sequence)) return null;
  return sequence.map((zone, index) => ({
    id: zone?.id ?? zone?.name ?? `zone-${index}`,
    name: zone?.name ?? zone?.id ?? `Zone ${index + 1}`,
    color: zone?.color || null,
    threshold: Number.isFinite(zone?.threshold)
      ? zone.threshold
      : getZoneMin(zone, { isFirst: index === 0 }),
    index: Number.isFinite(zone?.index) ? zone.index : index
  }));
};

const cloneSnapshot = (snapshot) => {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const { zoneSequence, ...rest } = snapshot;
  return {
    ...rest,
    zoneSequence: cloneZoneSequence(zoneSequence)
  };
};

const now = () => Date.now();

// Hysteresis: after a zone commit, rapid toggling protection activates for this window
const HYSTERESIS_COOLDOWN_MS = 5000;
// During rapid toggling, the new zone must be stable for this long before committing
const HYSTERESIS_STABILITY_MS = 3000;

export class ZoneProfileStore {
  constructor() {
    this._profiles = new Map();
    this._signature = null;
    this._baseZoneConfig = null;
    // Per-user hysteresis state: Map<userId, { committedZoneId, lastCommitTs, rawZoneId, rawZoneStableSince }>
    this._hysteresis = new Map();
  }

  setBaseZoneConfig(zoneConfig) {
    if (!Array.isArray(zoneConfig)) {
      this._baseZoneConfig = null;
      return;
    }
    this._baseZoneConfig = cloneZoneConfig(zoneConfig);
  }

  /**
   * Get the base zone configuration (for TreasureBox initialization)
   * @returns {Array|null} Clone of zone config or null if not set
   */
  getBaseZoneConfig() {
    if (!this._baseZoneConfig) return null;
    return cloneZoneConfig(this._baseZoneConfig);
  }

  clear() {
    this._profiles.clear();
    this._signature = null;
    this._hysteresis.clear();
  }

  syncFromUsers(usersIterable) {
    const nextMap = new Map();
    if (usersIterable && typeof usersIterable[Symbol.iterator] === 'function') {
      for (const user of usersIterable) {
        const profile = this.#buildProfileFromUser(user);
        if (profile) {
          nextMap.set(profile.id, profile);
        }
      }
    }
    const signature = this.#computeSignature(nextMap);
    if (signature === this._signature) {
      return false;
    }
    this._profiles = nextMap;
    this._signature = signature;
    return true;
  }

  getProfiles() {
    return Array.from(this._profiles.values()).map((profile) => this.#cloneProfile(profile));
  }

  getProfile(identifier) {
    const resolved = this.#resolveProfile(identifier);
    return resolved ? this.#cloneProfile(resolved) : null;
  }

  getProfileMap() {
    return new Map(
      Array.from(this._profiles.entries()).map(([id, profile]) => [id, this.#cloneProfile(profile)])
    );
  }

  getZoneState(identifier) {
    const profile = this.#resolveProfile(identifier);
    if (!profile) return null;
    return {
      slug: profile.slug,
      name: profile.name,
      heartRate: profile.heartRate,
      zoneId: profile.currentZoneId,
      zoneName: profile.currentZoneName,
      zoneColor: profile.currentZoneColor,
      nextZoneId: profile.nextZoneId,
      nextZoneThreshold: profile.nextZoneThreshold,
      currentZoneThreshold: profile.currentZoneThreshold,
      progress: profile.progress,
      rangeMin: profile.rangeMin,
      rangeMax: profile.rangeMax,
      targetHeartRate: profile.targetHeartRate,
      showBar: profile.showBar
    };
  }

  #resolveProfile(identifier) {
    if (!identifier) return null;
    if (typeof identifier === 'string') {
      // Direct lookup by ID
      return this._profiles.get(identifier) || null;
    }
    if (identifier?.id) {
      return this._profiles.get(identifier.id) || null;
    }
    return null;
  }

  #buildProfileFromUser(user) {
    if (!user?.id) return null;
    const userId = user.id;

    const hasCustomZones = Array.isArray(user.zoneConfig) && user.zoneConfig.length > 0;
    const sourceZoneConfig = hasCustomZones ? user.zoneConfig : this._baseZoneConfig;
    const normalizedZoneConfig = cloneZoneConfig(sourceZoneConfig || []);

    // DIAGNOSTIC: Log zone config source for debugging zone mismatch issues
    if (userId && normalizedZoneConfig.length > 0) {
      const warmZone = normalizedZoneConfig.find(z => z.id === 'warm' || z.name === 'Warm');
      const logger = getLogger();
      if (logger?.warn) {
        logger.warn('zoneprofilestore.build_profile', {
          userId,
          hasCustomZones,
          warmThreshold: warmZone?.min ?? null,
          zoneCount: normalizedZoneConfig.length
        });
      }
    }

    const heartRate = Number.isFinite(user?.currentData?.heartRate)
      ? Math.max(0, user.currentData.heartRate)
      : (Number.isFinite(user?.zoneSnapshot?.currentHR) ? Math.max(0, user.zoneSnapshot.currentHR) : 0);

    const snapshot = Array.isArray(sourceZoneConfig)
      ? deriveZoneProgressSnapshot({ zoneConfig: sourceZoneConfig, heartRate })
      : null;
    const normalizedSnapshot = cloneSnapshot(snapshot);
    const zoneSequence = normalizedSnapshot?.zoneSequence || this.#buildZoneSequence(normalizedZoneConfig);

    // Apply zone hysteresis: instant first transition, debounce rapid toggling
    const rawZoneId = normalizedSnapshot?.currentZoneId ?? null;
    const stabilized = this.#applyHysteresis(userId, rawZoneId, normalizedZoneConfig);

    return {
      id: userId,
      slug: userId,
      name: user.name,
      displayName: user.displayName || user.name,
      groupLabel: user.groupLabel || null,
      profileId: userId,
      zoneConfig: normalizedZoneConfig,
      zoneSequence,
      zoneSnapshot: normalizedSnapshot,
      currentZoneId: stabilized.zoneId,
      currentZoneName: stabilized.zoneName,
      currentZoneColor: stabilized.zoneColor,
      currentZoneThreshold: normalizedSnapshot?.currentZoneThreshold ?? null,
      nextZoneId: normalizedSnapshot?.nextZoneId ?? null,
      nextZoneThreshold: normalizedSnapshot?.nextZoneThreshold ?? null,
      heartRate,
      progress: normalizedSnapshot?.progress ?? null,
      rangeMin: normalizedSnapshot?.rangeMin ?? null,
      rangeMax: normalizedSnapshot?.rangeMax ?? null,
      targetHeartRate: normalizedSnapshot?.targetHeartRate ?? null,
      showBar: normalizedSnapshot?.showBar ?? false,
      source: user.source || null,
      updatedAt: now()
    };
  }

  /**
   * Apply zone hysteresis to prevent rapid visual toggling at zone boundaries.
   * - First zone transition: always instant
   * - Rapid toggling (second change within HYSTERESIS_COOLDOWN_MS): require
   *   the new zone to be stable for HYSTERESIS_STABILITY_MS before committing
   *
   * @param {string} userId
   * @param {string|null} rawZoneId - zone derived directly from current HR
   * @param {Array} zoneConfig - normalized zone config for name/color lookup
   * @returns {{ zoneId: string|null, zoneName: string|null, zoneColor: string|null }}
   */
  #applyHysteresis(userId, rawZoneId, zoneConfig) {
    const ts = now();
    const lookupZone = (id) => {
      if (!id) return { zoneId: null, zoneName: null, zoneColor: null };
      const zone = (zoneConfig || []).find(z => z.id === id);
      return {
        zoneId: id,
        zoneName: zone?.name ?? id,
        zoneColor: zone?.color ?? null
      };
    };

    let state = this._hysteresis.get(userId);

    // First time seeing this user — commit whatever we have, no delay
    if (!state) {
      this._hysteresis.set(userId, {
        committedZoneId: rawZoneId,
        lastCommitTs: ts,
        rawZoneId,
        rawZoneStableSince: ts
      });
      return lookupZone(rawZoneId);
    }

    // Track when the raw zone changed
    if (rawZoneId !== state.rawZoneId) {
      state.rawZoneId = rawZoneId;
      state.rawZoneStableSince = ts;
    }

    // Raw zone matches committed — no change needed
    if (rawZoneId === state.committedZoneId) {
      return lookupZone(state.committedZoneId);
    }

    // Raw zone differs from committed — decide whether to commit
    const timeSinceLastCommit = ts - state.lastCommitTs;
    const rawStableDuration = ts - state.rawZoneStableSince;

    if (timeSinceLastCommit > HYSTERESIS_COOLDOWN_MS) {
      // No recent zone change — this is a "first" transition, commit instantly
      state.committedZoneId = rawZoneId;
      state.lastCommitTs = ts;
      return lookupZone(rawZoneId);
    }

    if (rawStableDuration >= HYSTERESIS_STABILITY_MS) {
      // Rapid toggling detected but new zone has been stable long enough — commit
      state.committedZoneId = rawZoneId;
      state.lastCommitTs = ts;
      return lookupZone(rawZoneId);
    }

    // Rapid toggling, not yet stable — keep the committed zone
    return lookupZone(state.committedZoneId);
  }

  #buildZoneSequence(zoneConfig = []) {
    if (!Array.isArray(zoneConfig) || zoneConfig.length === 0) return [];
    return zoneConfig.map((zone, index) => ({
      id: zone?.id ?? zone?.name ?? `zone-${index}`,
      name: zone?.name ?? zone?.id ?? `Zone ${index + 1}`,
      color: zone?.color || null,
      threshold: Number.isFinite(zone?.min)
        ? zone.min
        : getZoneMin(zone, { isFirst: index === 0 }),
      index
    }));
  }

  #cloneProfile(profile) {
    if (!profile) return null;
    return {
      ...profile,
      zoneConfig: cloneZoneConfig(profile.zoneConfig),
      zoneSequence: cloneZoneSequence(profile.zoneSequence) || [],
      zoneSnapshot: profile.zoneSnapshot ? cloneSnapshot(profile.zoneSnapshot) : null
    };
  }

  #computeSignature(map) {
    const fingerprint = Array.from(map.values()).map((profile) => ({
      slug: profile.slug || profile.id,
      hr: profile.heartRate,
      zone: profile.currentZoneId,
      progress: profile.progress,
      config: profile.zoneConfig.map((zone) => `${zone.id}:${zone.min ?? ''}`).join('|')
    }));
    fingerprint.sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || '')));
    return JSON.stringify(fingerprint);
  }
}
