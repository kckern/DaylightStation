import { deriveZoneProgressSnapshot, getZoneMin, validateZoneLadder } from "./types.js";
import getLogger from "../../../../../../frontend/src/lib/logging/Logger.js";

const cloneZoneConfig = (config = []) => {
  if (!Array.isArray(config)) return [];
  return config.map((zone, index) => ({
    id: zone?.id ?? zone?.name ?? `zone-${index}`,
    name: zone?.name ?? zone?.id ?? `Zone ${index + 1}`,
    color: zone?.color || null,
    min: Number.isFinite(zone?.min) ? zone.min : null,
    // Preserve rings field for TreasureBox configuration.
    // `coins` is the pre-rename field name; a config or per-user override
    // written before 2026-08-26 still carries it, and reading only `rings`
    // silently zeroes every award with no error anywhere in the chain.
    rings: Number.isFinite(zone?.rings) ? zone.rings
      : (Number.isFinite(zone?.coins) ? zone.coins : 0)
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
// Schmitt trigger: to LEAVE a zone, HR must drop this many BPM below the zone's min threshold
const EXIT_MARGIN_BPM = 5;

export class ZoneProfileStore {
  constructor() {
    this._profiles = new Map();
    this._signature = null;
    this._baseZoneConfig = null;
    // Per-user hysteresis state: Map<userId, { committedZoneId, lastCommitTs, rawZoneId, rawZoneStableSince }>
    this._hysteresis = new Map();
    this._trustedUsers = new Set();
    this._zoneEntries = new Map();
    this._zoneEntrySequence = 0;
    // The last ladder that PASSED validation, per rider. A rebuild that fails
    // validation is rejected and this stays in force, so a transient bad
    // rebuild is invisible: no phantom zone, no wrong demotion, no lost rings.
    this._lastGoodLadder = new Map();
    // Riders currently running on a fallback ladder: Map<userId, { since, ticks }>.
    // Presence IS the rejected state — used to log the transition in and out
    // rather than one line per tick.
    this._ladderRejected = new Map();
    // Bumped only when the per-user zone THRESHOLDS change. Consumers that
    // cache anything derived from zoneConfig (TreasureBox's override maps) poll
    // this instead of being told to invalidate — a push model needs every call
    // site to remember, and one that forgets scores rings on stale thresholds.
    this._zoneConfigRevision = 0;
    this._zoneConfigSignature = null;
  }

  /**
   * Forget one user's zone smoothing state, so a new wearer of a relabelled
   * strap starts clean instead of inheriting the previous wearer's hysteresis.
   * @param {string} userId
   */
  resetZoneState(userId, reason = 'wearer-change') {
    if (userId == null) return;
    this._hysteresis.delete(userId);
    this._trustedUsers.delete(userId);
    this._zoneEntries.delete(userId);
    const profile = this._profiles.get(userId);
    if (profile) this._profiles.set(userId, {
      ...profile, zoneTrusted: false, zoneEntry: null,
      currentZoneId: null, currentZoneName: null, currentZoneColor: null
    });
    this._signature = null;
    getLogger().info('fitness.zone_state.reset', { userId, reason });
  }

  isZoneTrusted(userId) {
    return this._profiles.get(userId)?.zoneTrusted === true;
  }

  /** Revision of per-user thresholds, independent of volatile zone/HR state. */
  getZoneConfigRevision() {
    return this._zoneConfigRevision;
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
    this._trustedUsers.clear();
    this._zoneEntries.clear();
    getLogger().info('fitness.zone_state.reset', { reason: 'session-reset' });

    // A rider's ladder from one session must never authorize the next.
    this._lastGoodLadder.clear();
    this._ladderRejected.clear();
    this.#bumpZoneConfigRevisionIfChanged(this._profiles);
  }

  syncFromUsers(usersIterable) {
    const nextMap = new Map();
    if (usersIterable && typeof usersIterable[Symbol.iterator] === 'function') {
      for (const user of usersIterable) {
        // Profiles include a state machine and elapsed-time decisions. Historical
        // memoization skipped raw-zone changes and stability expiry on repeat HR,
        // and replayed pre-reset state. Always advance hysteresis; the output
        // signature still suppresses redundant consumer notifications.
        const profile = this.#buildProfileFromUser(user);
        if (profile) nextMap.set(profile.id, profile);
      }
    }
    const signature = this.#computeSignature(nextMap);
    if (signature === this._signature) {
      return false;
    }
    this._profiles = nextMap;
    this._signature = signature;
    this.#bumpZoneConfigRevisionIfChanged(nextMap);
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
      zoneTrusted: profile.zoneTrusted,
      zoneEntry: profile.zoneEntry ? { ...profile.zoneEntry } : null,
      zoneName: profile.currentZoneName,
      zoneColor: profile.currentZoneColor,
      displayZoneId: profile.displayZoneId,
      displayZoneName: profile.displayZoneName,
      displayZoneColor: profile.displayZoneColor,
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
      if (logger?.sampled) {
        logger.sampled('zoneprofilestore.build_profile', {
          userId,
          hasCustomZones,
          warmThreshold: warmZone?.min ?? null,
          zoneCount: normalizedZoneConfig.length
        }, { maxPerMinute: 5 });
      }
    }

    const heartRate = Number.isFinite(user?.currentData?.heartRate)
      ? Math.max(0, user.currentData.heartRate)
      : null; // Display missing HR explicitly; it cannot earn a default Cool.

    // THE enforcement point. Every consumer — fire toast, zone LEDs, TreasureBox
    // rings and coins, GovernanceEngine — reads the profile built here, so this
    // is the only place a ladder becomes a rider's committed reality, and the
    // only place the ladder is validated.
    const committedLadder = this.#committedLadder(userId, normalizedZoneConfig);

    const snapshot = committedLadder
      ? deriveZoneProgressSnapshot({ zoneConfig: committedLadder, heartRate })
      : null;
    const normalizedSnapshot = cloneSnapshot(snapshot);
    const zoneSequence = normalizedSnapshot?.zoneSequence
      || this.#buildZoneSequence(committedLadder || []);

    // Apply zone hysteresis: instant first transition, debounce rapid toggling
    const rawZoneId = normalizedSnapshot?.currentZoneId ?? null;
    const eligible = user.zoneReadingEligible !== false && heartRate > 0;
    if (!this._trustedUsers.has(userId) && eligible && committedLadder && rawZoneId === 'cool') {
      this._trustedUsers.add(userId);
    }
    const zoneTrusted = this._trustedUsers.has(userId);
    const previousZone = this._hysteresis.get(userId)?.committedZoneId ?? null;
    const stabilized = this.#applyHysteresis(
      userId, zoneTrusted ? rawZoneId : null, committedLadder || [],
      zoneTrusted && eligible ? heartRate : null
    );
    // Keep raw display/progress available before trust, without publishing it as
    // earned state. Only an accepted reading can justify a newly committed zone.
    const displayZone = committedLadder?.find(zone => zone.id === rawZoneId);
    if (zoneTrusted && eligible && stabilized.zoneId !== previousZone && stabilized.zoneId === rawZoneId) {
      this._zoneEntries.set(userId, {
        id: ++this._zoneEntrySequence,
        zoneId: stabilized.zoneId,
        heartRate,
        threshold: normalizedSnapshot?.currentZoneThreshold ?? null,
        enteredAt: now()
      });
    }
    const previous = this._profiles.get(userId);
    if (previous?.zoneTrusted !== zoneTrusted || previous?.currentZoneId !== stabilized.zoneId) {
      getLogger().info('fitness.zone_state.transition', {
        userId, zoneTrusted, reason: !zoneTrusted ? 'awaiting-real-cool' : (!previous?.zoneTrusted ? 'accepted-cool-baseline' : 'hysteresis'),
        heartRate, rawZoneId, committedZoneId: stabilized.zoneId,
        zoneEntry: this._zoneEntries.get(userId) || null
      });
    }

    return {
      id: userId,
      slug: userId,
      name: user.name,
      displayName: user.displayName || user.name,
      groupLabel: user.groupLabel || null,
      profileId: userId,
      zoneConfig: committedLadder || [],
      zoneSequence,
      zoneSnapshot: normalizedSnapshot,
      zoneTrusted,
      zoneEntry: this._zoneEntries.get(userId) ? { ...this._zoneEntries.get(userId) } : null,
      currentZoneId: stabilized.zoneId,
      currentZoneName: stabilized.zoneName,
      currentZoneColor: stabilized.zoneColor,
      displayZoneId: rawZoneId,
      displayZoneName: displayZone?.name ?? null,
      displayZoneColor: displayZone?.color ?? null,
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
   * Validate a candidate ladder and decide what the rider actually runs on.
   *
   * Valid   -> the candidate, and it becomes this rider's last known-good.
   * Invalid -> the last known-good ladder, or NULL when there isn't one yet
   *            (bootstrap: no committed zone, blank LED, no rings, no
   *            celebration, rather than a guessed zone).
   *
   * An absent config is "not configured yet", not a rejection — it produced a
   * zone-less rider before this existed and still does, without a warn.
   *
   * @param {string} userId
   * @param {Array} candidate - normalized zone config for this rebuild
   * @returns {Array|null} the ladder to commit, or null for no zone
   */
  #committedLadder(userId, candidate) {
    if (!Array.isArray(candidate) || candidate.length === 0) {
      return this._lastGoodLadder.get(userId) || null;
    }

    const verdict = validateZoneLadder(candidate);

    if (verdict.valid) {
      this._lastGoodLadder.set(userId, candidate);
      const wasRejected = this._ladderRejected.get(userId);
      if (wasRejected) {
        this._ladderRejected.delete(userId);
        getLogger().info('fitness.zone_ladder.recovered', {
          userId,
          rejectedForMs: now() - wasRejected.since,
          rejectedTicks: wasRejected.ticks
        });
      }
      return candidate;
    }

    const lastGood = this._lastGoodLadder.get(userId) || null;
    const state = this._ladderRejected.get(userId);
    if (state) {
      state.ticks += 1;
    } else {
      // Unsampled: a rejection is rare by definition. Logged on ENTERING the
      // rejected state only, so a persistently broken config costs two lines
      // for the session rather than one per tick.
      this._ladderRejected.set(userId, { since: now(), ticks: 1 });
      getLogger().warn('fitness.zone_ladder.rejected', {
        userId,
        reason: verdict.reason,
        detail: verdict.detail || null,
        thresholds: candidate.map((zone) => `${zone?.id}:${zone?.min ?? ''}`).join('|'),
        fellBackTo: lastGood ? 'last-good' : 'none'
      });
    }
    return lastGood;
  }

  /**
   * Apply zone hysteresis to prevent rapid visual toggling at zone boundaries.
   * - First accepted Cool baseline: instant
   * - Rapid toggling (second change within HYSTERESIS_COOLDOWN_MS): require
   *   the new zone to be stable for HYSTERESIS_STABILITY_MS before committing
   *
   * @param {string} userId
   * @param {string|null} rawZoneId - zone derived directly from current HR
   * @param {Array} zoneConfig - normalized zone config for name/color lookup
   * @returns {{ zoneId: string|null, zoneName: string|null, zoneColor: string|null, rawZoneId: string|null, rawZoneName: string|null, rawZoneColor: string|null }}
   */
  #applyHysteresis(userId, rawZoneId, zoneConfig, heartRate) {
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
    const lookupRawZone = (rawId) => {
      const raw = lookupZone(rawId);
      return { rawZoneId: raw.zoneId, rawZoneName: raw.zoneName, rawZoneColor: raw.zoneColor };
    };

    const sortedZones = (zoneConfig || []).slice().sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));
    const zoneRanks = {};
    sortedZones.forEach((z, idx) => { if (z?.id) zoneRanks[z.id] = idx; });
    const getZoneRank = (id) => id && Number.isFinite(zoneRanks[id]) ? zoneRanks[id] : -1;
    const getZoneMinThreshold = (id) => {
      const z = id && sortedZones.find(s => s.id === id);
      return z && Number.isFinite(z.min) ? z.min : null;
    };

    // No reading is not a zone change. Never commit it:
    // a commit here stamped lastCommitTs, so a strap restored within the
    // cooldown had its real zone held back for HYSTERESIS_STABILITY_MS — 170 bpm
    // read as Cool and governance flashed a warning (2026-10-21, arcade).
    let state = this._hysteresis.get(userId);
    if (!(Number.isFinite(heartRate) && heartRate > 0)) {
      // Hold the last trusted zone through a brief gap. Without a baseline,
      // report no earned zone and do not start smoothing from synthetic Cool.
      const shown = state ? state.committedZoneId : null;
      return { ...lookupZone(shown), ...lookupRawZone(rawZoneId) };
    }

    // First time seeing this user — commit whatever we have, no delay
    if (!state) {
      this._hysteresis.set(userId, {
        committedZoneId: rawZoneId,
        lastCommitTs: ts,
        rawZoneId,
        rawZoneStableSince: ts
      });
      return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId) };
    }

    // Track when the raw zone changed
    if (rawZoneId !== state.rawZoneId) {
      state.rawZoneId = rawZoneId;
      state.rawZoneStableSince = ts;
    }

    // Raw zone matches committed — no change needed
    if (rawZoneId === state.committedZoneId) {
      return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };
    }

    // Schmitt trigger: suppress downgrade if HR within exit margin
    const committedRank = getZoneRank(state.committedZoneId);
    const rawRank = getZoneRank(rawZoneId);
    if (committedRank >= 0 && rawRank >= 0 && rawRank < committedRank && Number.isFinite(heartRate)) {
      const committedMin = getZoneMinThreshold(state.committedZoneId);
      if (committedMin !== null) {
        const exitThreshold = Math.max(0, committedMin - EXIT_MARGIN_BPM);
        if (heartRate >= exitThreshold) {
          getLogger()?.sampled?.('zoneprofilestore.exit_margin_suppressed', {
            userId, heartRate, committedZoneId: state.committedZoneId, rawZoneId,
            committedMin, exitThreshold, exitMarginBpm: EXIT_MARGIN_BPM
          }, { maxPerMinute: 10 });
          state.rawZoneId = state.committedZoneId;
          state.rawZoneStableSince = ts;
          return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };
        }
      }
    }

    // Raw zone differs from committed — decide whether to commit
    const timeSinceLastCommit = ts - state.lastCommitTs;
    const rawStableDuration = ts - state.rawZoneStableSince;

    if (timeSinceLastCommit > HYSTERESIS_COOLDOWN_MS) {
      // No recent zone change — this is a "first" transition, commit instantly
      state.committedZoneId = rawZoneId;
      state.lastCommitTs = ts;
      return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId) };
    }

    if (rawStableDuration >= HYSTERESIS_STABILITY_MS) {
      // Rapid toggling detected but new zone has been stable long enough — commit
      state.committedZoneId = rawZoneId;
      state.lastCommitTs = ts;
      return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId) };
    }

    // Rapid toggling, not yet stable — keep the committed zone
    return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };
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
      zoneEntry: profile.zoneEntry ? { ...profile.zoneEntry } : null,
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
      rawZone: profile.displayZoneId,
      trusted: profile.zoneTrusted,
      entryId: profile.zoneEntry?.id ?? null,
      progress: profile.progress,
      config: profile.zoneConfig.map((zone) => `${zone.id}:${zone.min ?? ''}`).join('|')
    }));
    fingerprint.sort((a, b) => String(a.slug || '').localeCompare(String(b.slug || '')));
    return JSON.stringify(fingerprint);
  }

  #bumpZoneConfigRevisionIfChanged(map) {
    // Thresholds only. Deliberately narrower than #computeSignature, whose
    // volatile hr/zone/progress fields are what governance's change
    // notification needs and must not be narrowed.
    const parts = Array.from(map.values()).map((profile) => {
      const config = (profile.zoneConfig || []).map((zone) => `${zone.id}:${zone.min ?? ''}`).join('|');
      return `${profile.slug || profile.id}=${config}`;
    });
    parts.sort();
    const signature = parts.join(';');
    if (signature !== this._zoneConfigSignature) {
      this._zoneConfigSignature = signature;
      this._zoneConfigRevision += 1;
    }
  }

}
