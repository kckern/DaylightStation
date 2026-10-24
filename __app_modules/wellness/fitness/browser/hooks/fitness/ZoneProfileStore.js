import { deriveZoneProgressSnapshot, getZoneMin, validateZoneLadder } from "./types.js";
import { HR_SLEW_MAX_DELTA_BPM } from "./hrPlausibility.js";
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
// An UPWARD commit needs this many separate samples in the higher zone,
// spanning at least UPWARD_CONFIRM_MS. One corrupt 204 bpm packet committed
// Fire instantly twice on 2026-10-23 (ops:docs/_wip/bugs/2026-10-23-fitness-
// false-fire-ceremonies-recurring.md). A real climb pays about 1s.
export const UPWARD_CONFIRM_SAMPLES = 2;
export const UPWARD_CONFIRM_MS = 1000;
// A rider whose reading was lost resumes their zone without a fresh Cool when
// this store holds confirmed evidence for them from the same strap, at most
// this old. A new session never has evidence, so a strap still emitting a
// previous day's Fire stays suppressed (ops:docs/_wip/bugs/2026-10-23-
// fitness-returning-rider-zone-suppressed-after-break.md).
export const ZONE_TRUST_RESUME_WINDOW_MS = 60 * 60 * 1000;

export class ZoneProfileStore {
  constructor() {
    this._profiles = new Map();
    this._signature = null;
    this._baseZoneConfig = null;
    // Per-user hysteresis state: Map<userId, { committedZoneId, lastCommitTs, rawZoneId, rawZoneStableSince }>
    this._hysteresis = new Map();
    this._trustedUsers = new Set();
    // Last CONFIRMED trusted reading per rider: Map<userId, { deviceId, zoneId, heartRate, at }>.
    // Refreshed only by a sample that supports the committed zone, so a held
    // spike can never become evidence. Survives a confirmed reading loss; a
    // wearer change and a session reset delete it.
    this._trustEvidence = new Map();
    // A resume whose first reading was implausible against the evidence waits
    // for consistent samples: Map<userId, { hr, firstTs, sampleAt, samples }>.
    this._resumeCandidates = new Map();
    // Riders whose resume refusal (expired / other strap) has been logged once.
    this._resumeRefusalLogged = new Set();
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
    // The ladder (thresholds) each rider's zone was last derived from. Unlike
    // _lastGoodLadder this survives a config rebuild (clear preserveTrust), so
    // a mid-session threshold edit is seen as a CHANGE: Map<userId, signature>.
    this._ladderSignature = new Map();
    // Riders whose ladder changed and who have not since had a reading below
    // Fire under the new one. Any zone entry made meanwhile was produced by
    // reclassifying an unchanged HR, not by a crossing, and is flagged
    // `reclassified` so it can never be celebrated.
    this._reclassifyGuard = new Set();
    // Riders re-admitted by restoreTrust (v1 reload snapshot: trust with no
    // evidence). Their first commit is instant and unconfirmed, so their first
    // zone entry is flagged `resumed` and can never be celebrated.
    this._restoredWithoutEvidence = new Set();
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
    this._resumeCandidates.delete(userId);
    this._resumeRefusalLogged.delete(userId);
    this._reclassifyGuard.delete(userId);
    this._restoredWithoutEvidence.delete(userId);
    this._ladderSignature.delete(userId);
    // A confirmed loss is the same rider on the same strap going quiet (a
    // water break): keep the evidence so the return resumes. Anything else —
    // a handover, a correction — is a different person's heart.
    const keepsEvidence = reason === 'confirmed-loss' && this._trustEvidence.has(userId);
    if (!keepsEvidence) this._trustEvidence.delete(userId);
    const profile = this._profiles.get(userId);
    if (profile) this._profiles.set(userId, {
      ...profile, zoneTrusted: false, zoneEntry: null,
      currentZoneId: null, currentZoneName: null, currentZoneColor: null
    });
    this._signature = null;
    getLogger().info('fitness.zone_state.reset', { userId, reason, keepsEvidence });
  }

  /** Riders holding accepted-Cool trust, for persisting with the session. */
  getTrustedUserIds() {
    return [...this._trustedUsers];
  }

  /**
   * Re-admit trust a rider earned earlier in the same session (kiosk reload).
   * The caller decides eligibility; the next live reading commits the zone.
   */
  restoreTrust(userId) {
    if (userId == null || this._trustedUsers.has(userId)) return;
    this._trustedUsers.add(userId);
    // No evidence came with it: the first reading commits without the usual
    // upward confirmation, so that first entry must not count as a crossing.
    this._restoredWithoutEvidence.add(userId);
    this._signature = null;
  }

  /** The rider's last confirmed trusted reading, for persisting with the session. */
  getTrustEvidence(userId) {
    const evidence = this._trustEvidence.get(userId);
    return evidence ? { ...evidence } : null;
  }

  /** Riders holding resume evidence (trusted now, or lost within the window). */
  getEvidenceUserIds() {
    return [...this._trustEvidence.keys()];
  }

  /**
   * Re-admit a rider through the SAME rule a mid-session dropout uses (kiosk
   * reload): their next eligible reading from the same strap resumes the
   * zone once it is plausible against this evidence.
   */
  seedTrustEvidence(userId, evidence) {
    if (userId == null || !evidence || !Number.isFinite(evidence.at) || !Number.isFinite(evidence.heartRate)) return;
    this._trustEvidence.set(userId, {
      deviceId: evidence.deviceId != null ? String(evidence.deviceId) : null,
      zoneId: evidence.zoneId ?? null,
      heartRate: evidence.heartRate,
      at: evidence.at
    });
    this._signature = null;
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

  /**
   * @param {{ preserveTrust?: boolean }} [options] preserveTrust keeps each
   *   rider's accepted-Cool trust, committed zone and Fire entry evidence. A
   *   configuration rebuild within a session is not a new session or a new
   *   wearer, and must not replay a zone entry (a second Fire ceremony).
   */
  clear({ preserveTrust = false } = {}) {
    this._profiles.clear();
    this._signature = null;
    if (!preserveTrust) {
      this._hysteresis.clear();
      this._trustedUsers.clear();
      this._zoneEntries.clear();
      this._trustEvidence.clear();
      this._resumeCandidates.clear();
      this._resumeRefusalLogged.clear();
      this._ladderSignature.clear();
      this._reclassifyGuard.clear();
      this._restoredWithoutEvidence.clear();
    }
    getLogger().info('fitness.zone_state.reset', { reason: preserveTrust ? 'config-rebuild' : 'session-reset' });

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
    // Always keep the newest snapshot: an unchanged signature (same HR, same
    // zone) still carries a NEW reading time, which is what the Fire ceremony
    // counts samples and judges freshness by. The return value still reports
    // only meaningful changes to consumers.
    this._profiles = nextMap;
    if (signature === this._signature) {
      return false;
    }
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
    this.#observeLadder(userId, committedLadder);

    const snapshot = committedLadder
      ? deriveZoneProgressSnapshot({ zoneConfig: committedLadder, heartRate })
      : null;
    const normalizedSnapshot = cloneSnapshot(snapshot);
    const zoneSequence = normalizedSnapshot?.zoneSequence
      || this.#buildZoneSequence(committedLadder || []);

    // Apply zone hysteresis: instant first transition, debounce rapid toggling
    const rawZoneId = normalizedSnapshot?.currentZoneId ?? null;
    const eligible = user.zoneReadingEligible !== false && heartRate > 0;
    // Sample identity. Every rider is re-synced on every rider's packet, so a
    // re-sync of the same reading must not count as a second confirming sample.
    // Without a timestamp (standalone callers) each sync is its own sample.
    const sampleAt = Number.isFinite(user.zoneReadingAt) ? user.zoneReadingAt : null;
    const readingDeviceId = user.zoneReadingDeviceId != null ? String(user.zoneReadingDeviceId) : null;
    const readingSimulated = user.zoneReadingSimulated === true;
    let resumed = null;
    if (!this._trustedUsers.has(userId) && eligible && committedLadder) {
      if (rawZoneId === 'cool') {
        this._trustedUsers.add(userId);
        this._resumeCandidates.delete(userId);
      } else {
        resumed = this.#tryResumeFromEvidence(userId, { heartRate, rawZoneId, readingDeviceId, sampleAt });
      }
    }
    const zoneTrusted = this._trustedUsers.has(userId);
    const previousZone = this._hysteresis.get(userId)?.committedZoneId ?? null;
    const stabilized = this.#applyHysteresis(
      userId, zoneTrusted ? rawZoneId : null, committedLadder || [],
      zoneTrusted && eligible ? heartRate : null, sampleAt
    );
    // Keep raw display/progress available before trust, without publishing it as
    // earned state. Only an accepted reading can justify a newly committed zone.
    const displayZone = committedLadder?.find(zone => zone.id === rawZoneId);
    // A trusted real reading below Fire under the current ladder: from here a
    // Fire entry is a real upward crossing again.
    if (zoneTrusted && eligible && rawZoneId && rawZoneId !== 'fire' && this._reclassifyGuard.delete(userId)) {
      getLogger().info('fitness.zone_ladder.reclassify_guard_cleared', { userId, heartRate, rawZoneId });
    }
    if (zoneTrusted && eligible && stabilized.zoneId !== previousZone && stabilized.zoneId === rawZoneId) {
      const restoredFirst = this._restoredWithoutEvidence.delete(userId);
      this._zoneEntries.set(userId, {
        id: ++this._zoneEntrySequence,
        zoneId: stabilized.zoneId,
        heartRate,
        threshold: normalizedSnapshot?.currentZoneThreshold ?? null,
        enteredAt: now(),
        // A resumed zone is the zone the rider already had, not a crossing:
        // fireZoneTracker seeds on it and never celebrates it.
        ...(resumed || restoredFirst ? { resumed: true } : {}),
        ...(restoredFirst ? { restored: 'no-evidence' } : {}),
        // Reached by a ladder change under an unchanged HR, not a crossing.
        ...(this._reclassifyGuard.has(userId) ? { reclassified: true } : {}),
        // Fed by the simulator: drives zones and governance, never a ceremony.
        ...(readingSimulated ? { simulated: true } : {}),
        deviceId: readingDeviceId
      });
    }
    // Evidence for a later resume: only a trusted, eligible reading that the
    // committed zone agrees with. A spike held by confirmation never qualifies.
    if (zoneTrusted && eligible && stabilized.zoneId && stabilized.zoneId === rawZoneId) {
      this._trustEvidence.set(userId, {
        deviceId: readingDeviceId, zoneId: stabilized.zoneId, heartRate, at: now()
      });
    }
    const previous = this._profiles.get(userId);
    if (previous?.zoneTrusted !== zoneTrusted || previous?.currentZoneId !== stabilized.zoneId) {
      getLogger().info('fitness.zone_state.transition', {
        userId, zoneTrusted,
        reason: !zoneTrusted ? 'awaiting-real-cool'
          : resumed ? 'resumed-recent-evidence'
          : (!previous?.zoneTrusted ? 'accepted-cool-baseline' : 'hysteresis'),
        heartRate, rawZoneId, committedZoneId: stabilized.zoneId,
        previousZoneId: previous?.currentZoneId ?? null,
        previousHeartRate: previous?.heartRate ?? null,
        deviceId: readingDeviceId,
        commitPath: stabilized.commitPath ?? null,
        rawSamples: stabilized.rawSamples ?? null,
        rawStableMs: stabilized.rawStableMs ?? null,
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
      // The reading this profile was built from: which strap, when, whether
      // it was an accepted real sample, and whether the simulator sent it.
      // The Fire ceremony re-checks these at display time.
      zoneReadingAt: sampleAt,
      zoneReadingDeviceId: readingDeviceId,
      zoneReadingEligible: eligible,
      zoneReadingSimulated: readingSimulated,
      updatedAt: now()
    };
  }

  /**
   * The second way into trust, next to an accepted Cool: confirmed evidence of
   * this rider's zone from the same strap within ZONE_TRUST_RESUME_WINDOW_MS.
   * The current reading must be plausible against the evidence (within the
   * slew limit), or else two consistent samples at least UPWARD_CONFIRM_MS
   * apart — so a spike that happens to be the first packet back cannot resume
   * a rider straight into Fire. Hysteresis then restarts empty, so the zone is
   * that of the current reading.
   * @returns {{ path: string, evidence: object, ageMs: number }|null}
   */
  #tryResumeFromEvidence(userId, { heartRate, rawZoneId, readingDeviceId, sampleAt }) {
    const evidence = this._trustEvidence.get(userId);
    if (!evidence) return null;
    const ts = now();
    const ageMs = ts - evidence.at;
    const refuse = (reason) => {
      if (this._resumeRefusalLogged.has(userId)) return null;
      this._resumeRefusalLogged.add(userId);
      getLogger().info('fitness.zone_trust.resume_refused', {
        userId, reason, ageMs, deviceId: readingDeviceId, evidenceDeviceId: evidence.deviceId,
        heartRate, evidenceHeartRate: evidence.heartRate
      });
      return null;
    };
    if (ageMs > ZONE_TRUST_RESUME_WINDOW_MS) {
      this._trustEvidence.delete(userId);
      return refuse('evidence-expired');
    }
    if ((evidence.deviceId ?? null) !== (readingDeviceId ?? null)) return refuse('different-strap');

    let path = null;
    if (Math.abs(heartRate - evidence.heartRate) < HR_SLEW_MAX_DELTA_BPM) {
      path = 'evidence-plausible';
    } else {
      const candidate = this._resumeCandidates.get(userId);
      const consistent = candidate && Math.abs(heartRate - candidate.hr) < HR_SLEW_MAX_DELTA_BPM;
      if (consistent) {
        if (sampleAt == null || sampleAt !== candidate.sampleAt) candidate.samples += 1;
        candidate.hr = heartRate;
        candidate.sampleAt = sampleAt;
        if (candidate.samples >= UPWARD_CONFIRM_SAMPLES && ts - candidate.firstTs >= UPWARD_CONFIRM_MS) {
          path = 'consistent-samples';
        }
      } else {
        this._resumeCandidates.set(userId, { hr: heartRate, firstTs: ts, sampleAt, samples: 1 });
        getLogger().warn('fitness.zone_trust.resume_held', {
          userId, heartRate, rawZoneId, evidenceHeartRate: evidence.heartRate,
          evidenceZoneId: evidence.zoneId, ageMs, deviceId: readingDeviceId,
          replacedHeartRate: candidate?.hr ?? null
        });
      }
    }
    if (!path) return null;

    this._trustedUsers.add(userId);
    this._resumeCandidates.delete(userId);
    this._resumeRefusalLogged.delete(userId);
    getLogger().info('fitness.zone_trust.resumed', {
      userId, path, heartRate, rawZoneId, ageMs, deviceId: readingDeviceId,
      evidenceZoneId: evidence.zoneId, evidenceHeartRate: evidence.heartRate
    });
    return { path, evidence: { ...evidence }, ageMs };
  }

  /**
   * Notice a change to the thresholds a rider's zone is derived from. The
   * first ladder only records; a different one arms the reclassify guard (see
   * _reclassifyGuard) so a zone the new ladder assigns to an unchanged HR is
   * never mistaken for a crossing.
   */
  #observeLadder(userId, ladder) {
    if (!Array.isArray(ladder) || ladder.length === 0) return;
    const signature = ladder.map((zone) => `${zone?.id}:${zone?.min ?? ''}`).join('|');
    const prior = this._ladderSignature.get(userId);
    this._ladderSignature.set(userId, signature);
    if (prior == null || prior === signature) return;
    this._reclassifyGuard.add(userId);
    getLogger().info('fitness.zone_ladder.changed', {
      userId, from: prior, to: signature,
      committedZoneId: this._hysteresis.get(userId)?.committedZoneId ?? null
    });
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
   * - First accepted Cool baseline (or resumed zone): instant
   * - Upward move: needs UPWARD_CONFIRM_SAMPLES separate samples in the higher
   *   zone spanning UPWARD_CONFIRM_MS — one corrupt packet cannot commit it
   * - Downward move after a quiet HYSTERESIS_COOLDOWN_MS: instant
   * - Rapid toggling (second change within HYSTERESIS_COOLDOWN_MS): require
   *   the new zone to be stable for HYSTERESIS_STABILITY_MS before committing
   *
   * @param {string} userId
   * @param {string|null} rawZoneId - zone derived directly from current HR
   * @param {Array} zoneConfig - normalized zone config for name/color lookup
   * @returns {{ zoneId: string|null, zoneName: string|null, zoneColor: string|null, rawZoneId: string|null, rawZoneName: string|null, rawZoneColor: string|null }}
   */
  #applyHysteresis(userId, rawZoneId, zoneConfig, heartRate, sampleAt = null) {
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

    // First time seeing this user (accepted Cool, or a resume) — commit
    // whatever we have, no delay. Both entries into trust already passed
    // their own plausibility rule.
    if (!state) {
      this._hysteresis.set(userId, {
        committedZoneId: rawZoneId,
        lastCommitTs: ts,
        rawZoneId,
        rawZoneStableSince: ts,
        rawSamples: 1,
        lastSampleAt: sampleAt
      });
      return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId), commitPath: 'instant-first', rawSamples: 1, rawStableMs: 0 };
    }

    const isNewSample = sampleAt == null || sampleAt !== state.lastSampleAt;
    state.lastSampleAt = sampleAt;
    // Track when the raw zone changed, and how many separate samples it has held
    if (rawZoneId !== state.rawZoneId) {
      state.rawZoneId = rawZoneId;
      state.rawZoneStableSince = ts;
      state.rawSamples = 1;
    } else if (isNewSample) {
      state.rawSamples = (state.rawSamples || 0) + 1;
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
          state.rawSamples = 1;
          return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId) };
        }
      }
    }

    // Raw zone differs from committed — decide whether to commit
    const timeSinceLastCommit = ts - state.lastCommitTs;
    const rawStableDuration = ts - state.rawZoneStableSince;
    const upward = rawRank > committedRank;
    const trace = { rawSamples: state.rawSamples, rawStableMs: rawStableDuration };
    const commit = (commitPath) => {
      state.committedZoneId = rawZoneId;
      state.lastCommitTs = ts;
      return { ...lookupZone(rawZoneId), ...lookupRawZone(rawZoneId), commitPath, ...trace };
    };

    // An upward move is a claim of effort; one packet is not evidence of it.
    if (upward && !(state.rawSamples >= UPWARD_CONFIRM_SAMPLES && rawStableDuration >= UPWARD_CONFIRM_MS)) {
      return { ...lookupZone(state.committedZoneId), ...lookupRawZone(rawZoneId), commitPath: 'pending-upward', ...trace };
    }

    if (timeSinceLastCommit > HYSTERESIS_COOLDOWN_MS) {
      // No recent zone change — commit (a confirmed climb, or a drop at once)
      return commit(upward ? 'confirmed-upward' : 'downgrade');
    }

    if (rawStableDuration >= HYSTERESIS_STABILITY_MS) {
      // Rapid toggling detected but new zone has been stable long enough — commit
      return commit(upward ? 'confirmed-upward' : 'stable');
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
