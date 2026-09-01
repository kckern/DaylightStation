const NO_ZONE_LABEL = 'No Zone';
import getLogger from '../../lib/logging/Logger.js';

// MEMORY LEAK FIX: Limit timeline history to prevent unbounded growth
// At 5-second intervals: 1000 points = ~83 minutes of data
// This provides ample history for chart visualization while preventing memory exhaustion
const MAX_TIMELINE_POINTS = 1000;

// Strict identifier contract: TreasureBox is keyed by userId.
// - perUser Map is keyed by userId
// - processTick() receives activeParticipants Set containing userIds
// - profileId is preserved on accumulator for legacy/compat lookups only

export class FitnessTreasureBox {
  constructor(sessionRef) {
    this.sessionRef = sessionRef; // reference to owning FitnessSession
    this._log('constructor', { hasSessionRef: !!sessionRef });
    this._zoneProfileStore = null; // ZoneProfileStore reference for committed zone lookup
    this._zoneProfileOverrideCache = new Map(); // userId -> threshold map (never caches a miss)
    this._zoneOverrideCacheRev = null; // ZoneProfileStore zone-config revision the cache was built at
    // userIds already warned about a missing profile. Deliberately NOT cleared
    // when the threshold cache is dropped — that happens on any zone-config
    // change, so clearing this alongside it would restore the per-sample warn
    // flood the guard exists to prevent. Cleared only at session boundaries
    // (setZoneProfileStore / reset).
    this._zoneOverrideMissLogged = new Set();
    this.activityMonitor = null;  // ActivityMonitor for checking if user is active
    this.ringTimeUnitMs = 5000; // default; will be overridden by configuration injection
    this.globalZones = []; // array of {id,name,min,color,rings}
    this.usersConfigOverrides = new Map(); // userId -> overrides object {active,warm,hot,fire}
    this.buckets = {}; // color -> ring total
    this.totalRings = 0;
    this.perUser = new Map(); // userId -> accumulator
    this.lastTick = Date.now(); // for elapsed computation if needed
    this._timeline = {
      perColor: new Map(),
      cumulative: [],
      lastIndex: -1
    };
    // Compatibility: device -> entity mapping retained, but strict mode ignores entityId for accounting.
    this._deviceEntityMap = new Map(); // deviceId -> entityId
    // Note: Per-user ring timelines removed (Priority 5)
    // Rings are now written directly to main timeline via assignMetric('user:X:rings_total')
    // Chart uses getSeries() to read from main timeline
    // External mutation callback (set by context) to trigger UI re-render
    this._mutationCb = null;
    // Structured award callback for ephemeral celebrations. Accounting remains
    // here; consumers only observe a completed, canonical award.
    this._ringAwardCb = null;
    this._autoInterval = null; // timer id
    // REMOVED: _governanceCb - governance now reads from ZoneProfileStore on tick boundaries
  }

  _log(event, data = {}, level = 'debug') {
    const logger = getLogger();
    if (logger && typeof logger[level] === 'function') {
      logger[level](`treasurebox.${event}`, data);
    } else {
      logger?.warn(`treasurebox.${event}`, data);
    }
    try {
      if (this.sessionRef?._log) {
        this.sessionRef._log(`treasurebox_${event}`, data);
      }
    } catch (_) { /* ignore */ }
  }

  /**
   * Set the ActivityMonitor for activity-aware ring processing
   * @param {import('../../modules/Fitness/domain/ActivityMonitor.js').ActivityMonitor} monitor
   */
  setActivityMonitor(monitor) {
    this.activityMonitor = monitor;
  }

  setZoneProfileStore(store) {
    this._zoneProfileStore = store;
    this._zoneProfileOverrideCache = new Map();
    this._zoneOverrideCacheRev = null;
    this._zoneOverrideMissLogged = new Set();
  }

  setMutationCallback(cb) { this._mutationCb = typeof cb === 'function' ? cb : null; }
  setRingAwardCallback(cb) { this._ringAwardCb = typeof cb === 'function' ? cb : null; }
  _notifyMutation() { if (this._mutationCb) { try { this._mutationCb(); } catch(_){} } }

  configure({ ringTimeUnitMs, zones, users }) {
    // Note: _userTimelines removed (Priority 5) - rings written to main timeline

    if (typeof ringTimeUnitMs === 'number' && ringTimeUnitMs > 0) {
      this.ringTimeUnitMs = ringTimeUnitMs;
    }
    if (this.sessionRef?.timebase) {
      this.sessionRef.timebase.intervalMs = this.ringTimeUnitMs;
    }
    if (Array.isArray(zones)) {
      // Normalize zones sorted by min ascending for evaluation (we'll iterate descending)
      this.globalZones = zones.map(z => ({
        id: z.id,
        name: z.name,
        min: Number(z.min) || 0,
        color: z.color,
        // `coins` is the pre-rename per-zone field name. A config or per-user
        // override written before the 2026-08-26 rename still carries it, and
        // silently reading it as 0 makes every ring award a no-op with no
        // error anywhere in the chain.
        rings: Number(z.rings ?? z.coins) || 0
      })).sort((a,b) => a.min - b.min);
      // Pre-sort descending for resolveZone() to avoid re-sorting on every call
      this._globalZonesDescending = [...this.globalZones].reverse();
      // Initialize bucket colors
      for (const z of this.globalZones) {
        if (!(z.color in this.buckets)) this.buckets[z.color] = 0;
        if (!this._timeline.perColor.has(z.color)) {
          this._timeline.perColor.set(z.color, []);
        }
      }
      // DIAGNOSTIC: Log zone configuration for debugging
      this._log('zones_configured', {
        zoneCount: this.globalZones.length,
        zoneIds: this.globalZones.map(z => z.id)
      });
    } else if (zones !== undefined) {
      // Log if zones was passed but not an array (indicates bug)
      this._log('zones_configure_invalid', { zonesType: typeof zones, zonesValue: zones }, 'warn');
    }
    // Extract user overrides (provided as part of users.primary/secondary config shape)
    if (users) {
      let overrideCount = 0;
      const collectOverrides = (arr) => {
        if (!Array.isArray(arr)) return;
        arr.forEach((u) => {
          if (!u?.zones) return;
          const userKey = u.id || u.profileId || null;
          if (!userKey) {
            this._log('user_override_missing_id', { name: u?.name || null });
            return;
          }
          this.usersConfigOverrides.set(userKey, { ...u.zones });
          overrideCount++;
        });
      };
      if (Array.isArray(users)) {
        collectOverrides(users);
      } else if (typeof users === 'object') {
        Object.values(users).forEach((value) => collectOverrides(value));
      }
      // DIAGNOSTIC: Log user zone override configuration
      if (overrideCount > 0) {
        this._log('user_zone_overrides_configured', {
          overrideCount,
          userIds: Array.from(this.usersConfigOverrides.keys())
        });
      }
    }
    // Backfill existing users with zone data
    this._backfillExistingUsers();
    // NOTE: Timer removed - TreasureBox is now tick-driven via processTick()
    // This eliminates race conditions between ring awards and dropout detection
  }

  // DEPRECATED: Timer-based processing removed to fix race conditions
  // TreasureBox is now driven by FitnessSession._collectTimelineTick() via processTick()
  _startAutoTicker() {
    // No-op: timer-based processing has been removed
    // Ring processing now happens synchronously during session tick
    this._log('auto_ticker_disabled', { usingTickDriven: true });
  }

  stop() { if (this._autoInterval) { clearInterval(this._autoInterval); this._autoInterval = null; } }

  /**
   * MEMORY LEAK FIX: Reset all state for session cleanup
   * Called by FitnessSession.endSession() to prevent data accumulation across sessions
   */
  reset() {
    this._log('reset', { 
      hadUsers: this.perUser.size,
      hadTimelinePoints: this._timeline.cumulative.length,
      totalRings: this.totalRings
    });
    
    // Clear all accumulated state
    this.buckets = {};
    this.totalRings = 0;
    this.perUser.clear();
    this._timeline.perColor.clear();
    this._timeline.cumulative = [];
    this._timeline.lastIndex = -1;
    this._deviceEntityMap.clear();
    this.usersConfigOverrides.clear();
    this._zoneProfileOverrideCache = new Map();
    this._zoneOverrideCacheRev = null;
    this._zoneOverrideMissLogged = new Set();
    this._globalZonesDescending = [];

    // Note: Keep globalZones, ringTimeUnitMs, callbacks - these are configuration, not session state
  }

  /**
   * Restore TreasureBox state from saved session data (for session resume).
   * @param {Object} saved - { totalRings, buckets }
   */
  restore(saved) {
    if (!saved) return;
    // `totalCoins` is the pre-2026-08-26 name. Restoring a session written
    // before the rename must not silently reset the count to zero — that would
    // look like the ledger, not like a read failure.
    const savedTotal = typeof saved.totalRings === 'number' ? saved.totalRings
      : (typeof saved.totalCoins === 'number' ? saved.totalCoins : null);
    if (savedTotal !== null) {
      this.totalRings = savedTotal;
    }
    if (saved.buckets && typeof saved.buckets === 'object') {
      this.buckets = { ...saved.buckets };
    }
    this._log('restored', { totalRings: this.totalRings, buckets: Object.keys(this.buckets) });
  }

  /**
  * Compatibility: Set the active session entity for a device.
  * Strict mode does not use entityId for accounting, but we keep this for legacy callers.
   *
   * @param {string} deviceId - Heart rate device ID
   * @param {string} entityId - Session entity ID to receive HR data
   */
  setActiveEntity(deviceId, entityId) {
    const key = String(deviceId);
    if (entityId) {
      this._deviceEntityMap.set(key, entityId);
      this._log('set_active_entity', { deviceId: key, entityId, map: [...this._deviceEntityMap.entries()] });
    } else {
      this._deviceEntityMap.delete(key);
      this._log('clear_active_entity', { deviceId: key });
    }
  }

  /**
   * Phase 2: Get the active entity ID for a device
   * @param {string} deviceId
   * @returns {string|null}
   */
  getActiveEntity(deviceId) {
    return this._deviceEntityMap.get(String(deviceId)) || null;
  }

  /**
   * Phase 5: Check if an entity is actively receiving HR data
   * An entity is considered active if it received HR data within the last 10 seconds
   * @param {string} entityId - Entity ID to check
   * @returns {boolean} - True if entity is active
   */
  isEntityActive(entityId) {
    // Strict userId mode: entities are not tracked.
    this._log('entity_active_check_disabled', { entityId });
    return false;
  }

  /**
   * Phase 2: Transfer accumulator data from one entity to another.
   * Used during grace period transfers when a brief session is merged into successor.
   * 
   * @param {string} fromEntityId - Source entity ID
   * @param {string} toEntityId - Destination entity ID
   * @returns {boolean} - True if transfer occurred
   */
  transferAccumulator(fromEntityId, toEntityId) {
    // Strict userId mode: entities are not tracked.
    this._log('transfer_disabled', { fromEntityId, toEntityId });
    return false;
  }

  /**
   * Phase 2: Create a fresh accumulator for a new entity
   * @param {number} [startTime] - Optional start time (defaults to now)
   * @returns {Object} Fresh accumulator object
   */
  _createAccumulator(startTime) {
    const now = startTime || Date.now();
    return {
      currentIntervalStart: now,
      highestZone: null,
      lastHR: null,
      currentColor: NO_ZONE_LABEL,
      lastColor: NO_ZONE_LABEL,
      lastZoneId: null,
      totalRings: 0
    };
  }

  /**
   * Phase 2: Initialize accumulator for a new session entity
   * Called when a new entity is created to ensure it starts with fresh state
   * 
   * @param {string} entityId - Session entity ID
   * @param {number} [startTime] - Optional start time
   */
  initializeEntity(entityId, startTime) {
    // Strict userId mode: do not create entity-keyed accumulators.
    this._log('entity_init_disabled', { entityId, startTime: startTime || Date.now() });
  }

  // Rename a user in the perUser map (used when guest assigned to preserve zone state)
  // DEPRECATED: Use entity-based tracking instead
  renameUser(oldName, newName) {
    if (!oldName || !newName || oldName === newName) return false;
    const acc = this.perUser.get(oldName);
    if (!acc) return false;
    // Copy the accumulator to the new name
    this.perUser.set(newName, { ...acc });
    // Remove the old entry
    this.perUser.delete(oldName);
    this._notifyMutation();
    return true;
  }

  // Backfill highestZone from lastHR so already-on monitors immediately accrue rings
  _backfillExistingUsers() {
    if (!this.perUser.size || !this.globalZones.length) return;
    const now = Date.now();
    for (const [userId, acc] of this.perUser.entries()) {
      if (!acc.currentIntervalStart) acc.currentIntervalStart = now;
      if (acc.lastHR && acc.lastHR > 0 && !acc.highestZone) {
        const zone = this.resolveZone(userId, acc.lastHR);
        if (zone) {
          acc.highestZone = zone;
          acc.currentColor = zone.color;
          acc.lastColor = zone.color;
          acc.lastZoneId = zone.id || zone.name || null;
        }
      }
    }
  }

  /**
   * Process ring intervals for active participants only.
   * Called synchronously from FitnessSession._collectTimelineTick() to ensure
   * ring processing is aligned with session ticks and dropout detection.
   *
    * Strict mode: activeParticipants contains userIds, matching the keys in perUser Map.
   *
   * @param {number} tick - Current tick index
    * @param {Set<string>} activeParticipants - Set of userIds for active participants
   * @param {Object} options - Additional options (legacy, no longer used)
   */
  processTick(tick, activeParticipants, _options = {}) {
    this._log('process_tick', {
      tick,
      perUserSize: this.perUser.size,
      activeParticipants: Array.from(activeParticipants),
      ringTimeUnitMs: this.ringTimeUnitMs,
      perUserKeys: Array.from(this.perUser.keys())
    }, 'debug');
    if (!this.perUser.size) return;

    // Migration shim: if legacy entity-key accumulators exist, migrate them to profileId.
    const legacyEntityKeysToDelete = [];
    for (const [key, acc] of this.perUser.entries()) {
      if (!key?.startsWith?.('entity-')) continue;
      const profileId = acc?.profileId;
      if (profileId && !this.perUser.has(profileId)) {
        this.perUser.set(profileId, acc);
        this._log('migrated_entity_accumulator', { entityId: key, profileId });
      }
      legacyEntityKeysToDelete.push(key);
    }
    legacyEntityKeysToDelete.forEach((key) => this.perUser.delete(key));

    const now = Date.now();

    for (const [accKey, acc] of this.perUser.entries()) {
      const profileId = acc.profileId || accKey;

      // CRITICAL: Only process intervals for ACTIVE participants
      // This prevents ring accumulation during dropout
      // Phase 4: Simplified - activeParticipants and perUser use same ID scheme
      if (!activeParticipants.has(accKey)) {
        this._log('user_not_active', { userId: accKey, profileId }, 'debug');
        // User not active - clear their highestZone to prevent stale awards
        acc.highestZone = null;
        acc.currentColor = null;
        continue;
      }
      
      if (!acc.currentIntervalStart) { acc.currentIntervalStart = now; continue; }
      const elapsed = now - acc.currentIntervalStart;
      this._log('interval_check', { accKey, elapsed, ringTimeUnitMs: this.ringTimeUnitMs, hasHighestZone: !!acc.highestZone }, 'debug');
      if (elapsed >= this.ringTimeUnitMs) {
        if (acc.highestZone) {
          this._log('awarding_rings', { accKey, zone: { id: acc.highestZone.id, name: acc.highestZone.name, rings: acc.highestZone.rings } });
          this._awardRings(accKey, acc.highestZone);
        } else {
          this._log('no_highest_zone', { accKey }, 'debug');
        }
        acc.currentIntervalStart = now;
        acc.highestZone = null;
        acc.currentColor = null;
      }
    }
  }
  
  // Legacy method - kept for backward compatibility but delegates to processTick
  _processIntervals() {
    // This should not be called anymore - TreasureBox is tick-driven
    // If called, process all users (legacy behavior) but log warning
    this._log('legacy_process_intervals_called', { shouldUseProcessTick: true });
    const allUsers = new Set([...this.perUser.keys()]);
    this.processTick(-1, allUsers, {});
  }

  /**
   * MEMORY LEAK FIX: Truncate timeline to MAX_TIMELINE_POINTS
   * Keeps most recent data, discards oldest data to prevent unbounded growth
   */
  _truncateTimeline() {
    const cumLen = this._timeline.cumulative.length;
    if (cumLen <= MAX_TIMELINE_POINTS) return;
    
    const excess = cumLen - MAX_TIMELINE_POINTS;
    this._log('truncate_timeline', { 
      before: cumLen, 
      after: MAX_TIMELINE_POINTS, 
      removed: excess 
    }, 'info');
    
    // Keep most recent MAX_TIMELINE_POINTS entries
    this._timeline.cumulative = this._timeline.cumulative.slice(-MAX_TIMELINE_POINTS);
    
    // Truncate each color series
    this._timeline.perColor.forEach((series, color) => {
      if (series.length > MAX_TIMELINE_POINTS) {
        this._timeline.perColor.set(color, series.slice(-MAX_TIMELINE_POINTS));
      }
    });
    
    // Adjust lastIndex to reflect truncation
    this._timeline.lastIndex = Math.max(-1, this._timeline.lastIndex - excess);
  }

  _ensureTimelineIndex(index, color) {
    if (index < 0) return;
    if (color) {
      if (!this._timeline.perColor.has(color)) {
        this._timeline.perColor.set(color, []);
      }
      const colorSeries = this._timeline.perColor.get(color);
      while (colorSeries.length <= index) {
        const prev = colorSeries.length > 0 ? (colorSeries[colorSeries.length - 1] ?? 0) : 0;
        colorSeries.push(prev);
      }
    }
    const cumulative = this._timeline.cumulative;
    while (cumulative.length <= index) {
      const prev = cumulative.length > 0 ? (cumulative[cumulative.length - 1] ?? 0) : 0;
      cumulative.push(prev);
    }
    
    // MEMORY LEAK FIX: Enforce timeline bounds after growth
    this._truncateTimeline();
  }

  getTimelineSnapshotForIndex(index) {
    if (!Number.isFinite(index) || index < 0) return null;
    this._ensureTimelineIndex(index);
    const perColor = {};
    this._timeline.perColor.forEach((series, color) => {
      if (!series || !series.length) return;
      const value = series[index];
      if (Number.isFinite(value)) {
        perColor[color] = value;
      }
    });
    const cumulative = this._timeline.cumulative[index];
    return {
      perColor,
      cumulative: Number.isFinite(cumulative) ? cumulative : null,
      totalRings: this.totalRings
    };
  }

  // Determine zone for HR for a given user, returns zone object or null
  resolveZone(userId, hr) {
    if (!hr || hr <= 0 || this.globalZones.length === 0) return null;

    // Build effective thresholds: priority is usersConfigOverrides > ZoneProfileStore > global
    let overrides = this.usersConfigOverrides.get(userId);

    // If no manual overrides, pull from ZoneProfileStore (per-user custom zones).
    // Cache the converted map to avoid deep-cloning the profile on every HR
    // sample — but NEVER cache a miss. The store builds profiles lazily, so a
    // read can precede the sync that would have populated it (2026-09-01: the
    // caller's own ordering did exactly that, see FitnessSession's ORDER
    // MATTERS note); a cached null meant global thresholds for the rest of the
    // session.
    if (!overrides && this._zoneProfileStore) {
      // Pull the store's threshold revision rather than waiting to be told:
      // it moves only when some user's zoneConfig actually changes, and no
      // call site can forget to invalidate.
      const rev = this._zoneProfileStore.getZoneConfigRevision?.() ?? 0;
      if (rev !== this._zoneOverrideCacheRev) {
        this._zoneProfileOverrideCache.clear();
        this._zoneOverrideCacheRev = rev;
      }
      if (this._zoneProfileOverrideCache.has(userId)) {
        overrides = this._zoneProfileOverrideCache.get(userId);
      } else {
        const profile = this._zoneProfileStore.getProfile(userId);
        if (profile?.zoneConfig && Array.isArray(profile.zoneConfig)) {
          // Convert zoneConfig array [{id:'active', min:125}, ...] to override map {active: 125, ...}
          overrides = {};
          for (const z of profile.zoneConfig) {
            const key = z.id || z.name?.toLowerCase();
            if (key && typeof z.min === 'number') {
              overrides[key] = z.min;
            }
          }
          this._zoneProfileOverrideCache.set(userId, overrides);
        } else if (!this._zoneOverrideMissLogged.has(userId)) {
          // A miss means the store has no profile for this user AT ALL — i.e.
          // they never reached syncFromUsers. It is not the guest case: a
          // present, synced guest gets a profile carrying the base zone config
          // and resolves normally. FitnessSession syncs before it feeds us, so
          // on a healthy session this never fires; if it does, that user is
          // being scored on global thresholds and someone should know.
          // Warned ONCE per user — a miss recurs on every HR sample (~1/s),
          // which would flood the log store and bury the signal.
          this._zoneOverrideMissLogged.add(userId);
          this._log('zone_override_miss', { userId }, 'warn');
        }
      }
    }

    if (!overrides) overrides = {};

    const zonesDescending = this._globalZonesDescending || [...this.globalZones].sort((a, b) => b.min - a.min);
    for (const zone of zonesDescending) {
      const key = zone.id || zone.name?.toLowerCase();
      const overrideMin = overrides[key];
      const effectiveMin = (typeof overrideMin === 'number') ? overrideMin : zone.min;
      if (hr >= effectiveMin) return { ...zone, min: effectiveMin };
    }
    return null;
  }

  /**
   * Record raw HR sample for an entity (Phase 2) or user (legacy).
   * 
   * Phase 2 behavior: If entityId is provided, uses entity-based tracking.
   * Legacy behavior: Falls back to userId-based tracking for backward compatibility.
   * 
   * @param {string} entityOrUserId - Entity ID (Phase 2) or user ID (legacy)
   * @param {number} hr - Heart rate value
   * @param {Object} [options] - Additional options
   * @param {string} [options.profileId] - Profile ID for zone overrides lookup
   */
  recordUserHeartRate(entityOrUserId, hr, options = {}) {
    // Strict mode: accounting is keyed by userId.
    // If callers pass an entityId, require profileId to map it back to userId.
    const isEntityId = entityOrUserId?.startsWith?.('entity-');
    const profileId = options.profileId || (isEntityId ? null : entityOrUserId);
    const rhLogger = getLogger();
    if (rhLogger?.sampled) {
      rhLogger.sampled('treasurebox.record_heart_rate', {
        entityOrUserId,
        hr,
        profileId,
        hasGlobalZones: this.globalZones.length > 0,
        isEntityId
      }, { maxPerMinute: 5 });
    }
    if (!profileId) {
      this._log('missing_profile_id_for_entity', { entityOrUserId });
      return;
    }
    if (!this.globalZones.length) return; // disabled gracefully if no zones
    const now = Date.now();
    
    // Use userId as accumulator key
    const accKey = profileId;
    let acc = this.perUser.get(accKey);
    if (!acc) {
      acc = this._createAccumulator(now);
      // Store profileId for activity checking in processTick()
      acc.profileId = profileId;
      this.perUser.set(accKey, acc);
      this._log('created_accumulator', { accKey, profileId, isNew: true });
    } else if (!acc.profileId) {
      // Ensure profileId is set even on existing accumulators
      acc.profileId = profileId;
    }
    
    // Phase 5: Track last HR timestamp for activity checking
    acc._lastHRTimestamp = now;
    
    // HR dropout (<=0) resets interval without award
    if (!hr || hr <= 0 || Number.isNaN(hr)) {
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      acc.lastHR = hr;
      acc.currentColor = NO_ZONE_LABEL;
      acc.lastColor = NO_ZONE_LABEL; // persist display as No Zone until first valid reading
      acc.lastZoneId = null;
      return;
    }
    
    // Determine zone for this reading (use profileId for zone overrides)
    const zone = this.resolveZone(profileId, hr);
    const hasOverrides = this.usersConfigOverrides.has(profileId);
    const userOverrides = this.usersConfigOverrides.get(profileId);
    this._log('zone_resolved', {
      accKey,
      profileId,
      hr,
      zone: zone ? { id: zone.id, name: zone.name, min: zone.min, rings: zone.rings } : null,
      hasOverrides,
      overrideKeys: hasOverrides ? Object.keys(userOverrides || {}) : null
    });
    if (zone) {
      if (!acc.highestZone || zone.min > acc.highestZone.min) {
        this._log('update_highest_zone', { accKey, zone: { id: zone.id, name: zone.name } });
        acc.highestZone = zone;
      }

      // For display (LEDs, roster), prefer committed zone from ZoneProfileStore (honors hysteresis)
      const committedZone = this._zoneProfileStore?.getZoneState?.(accKey);
      const effectiveColor = committedZone?.zoneColor || zone.color;
      const effectiveZoneId = committedZone?.displayZoneId || committedZone?.zoneId || zone.id || zone.name || null;
      acc.currentColor = effectiveColor;
      acc.lastColor = effectiveColor;
      acc.lastZoneId = effectiveZoneId;
    }
    acc.lastHR = hr;
    
    // Check interval completion
    const elapsed = now - acc.currentIntervalStart;
    if (elapsed >= this.ringTimeUnitMs) {
      this._log('interval_complete', { accKey, elapsed, hasHighestZone: !!acc.highestZone });
      if (acc.highestZone) {
        this._awardRings(accKey, acc.highestZone);
      }
      // Start new interval after awarding (or discard if none)
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      // If last HR went invalid later we'll set No Zone in HR branch; here we keep the lastColor but clear currentColor to signal awaiting new reading
      acc.currentColor = NO_ZONE_LABEL;
    }
  }

  /**
   * Phase 2: Record HR sample for a device, routing to the active entity.
   * This is the preferred method when entity tracking is enabled.
   * 
   * @param {string} deviceId - Heart rate device ID
   * @param {number} hr - Heart rate value
   * @param {Object} [options] - Additional options
   * @param {string} [options.profileId] - Profile ID for zone overrides lookup
   * @param {string} [options.fallbackUserId] - User ID to use if no entity is mapped
   */
  recordHeartRateForDevice(deviceId, hr, options = {}) {
    const key = String(deviceId);
    const entityId = this._deviceEntityMap.get(key);
    
    // Debug: Log the entity mapping state
    if (!entityId && options.fallbackUserId) {
      getLogger().debug('fitness.treasure.no_entity_mapped', {
        deviceId: key,
        fallbackUserId: options.fallbackUserId,
        mapSize: this._deviceEntityMap.size,
        mappedDevices: Array.from(this._deviceEntityMap.keys())
      });
    }
    
    // Strict userId mode: always route to a userId key.
    const userId = options.fallbackUserId || options.profileId || null;
    if (!userId) {
      this._log('device_no_user_mapping', { deviceId: key, entityId });
      return;
    }
    this.recordUserHeartRate(userId, hr, { ...options, profileId: userId });
  }

  // Note: _ensureUserTimelineIndex removed (Priority 5)
  // Per-user ring timelines are now in main timeline via user:X:rings_total

  _awardRings(accKey, zone) {
    this._log('award_rings_called', { accKey, zone: zone ? { id: zone.id, name: zone.name, rings: zone.rings } : null, hasActivityMonitor: !!this.activityMonitor });
    if (!zone) return;
    
    const acc = this.perUser.get(accKey);
    const profileId = acc?.profileId || accKey;
    
    // PRIORITY 2: Safety check - don't award rings if user is not active
    // This is a backup to processTick() which also checks activity
    // For entity keys, check activity by profileId (not entityId)
    if (this.activityMonitor) {
      const checkId = accKey;
      const isActive = this.activityMonitor.isActive(checkId);
      this._log('activity_check', { accKey, checkId, isActive });
      if (!isActive) {
        // User is not actively broadcasting - skip award
        this._log('skip_award_inactive', { accKey, profileId });
        return;
      }
    }
    
    if (!(zone.color in this.buckets)) this.buckets[zone.color] = 0;
    this.buckets[zone.color] += zone.rings;
    this.totalRings += zone.rings;
    const start = this.sessionRef?.startTime || this.sessionRef?.timebase?.startAbsMs || Date.now();
    const intervalMs = this.ringTimeUnitMs > 0 ? this.ringTimeUnitMs : 5000;
    const now = Date.now();
    const intervalIndex = Math.floor(Math.max(0, now - start) / intervalMs);
    this._ensureTimelineIndex(intervalIndex, zone.color);
    const colorSeries = this._timeline.perColor.get(zone.color);
    if (colorSeries) {
      colorSeries[intervalIndex] += zone.rings;
    }
    if (this._timeline.cumulative.length > intervalIndex) {
      this._timeline.cumulative[intervalIndex] += zone.rings;
    }
    this._timeline.lastIndex = Math.max(this._timeline.lastIndex, intervalIndex);
    if (this.sessionRef?.timebase && intervalIndex + 1 > this.sessionRef.timebase.intervalCount) {
      this.sessionRef.timebase.intervalCount = intervalIndex + 1;
    }
    // acc already retrieved above for profileId lookup
    if (acc) {
      acc.totalRings = (acc.totalRings || 0) + zone.rings;
      acc.lastAwardedAt = now;
      this._log('rings_awarded', {
        accKey,
        profileId,
        zone: zone.id || zone.name,
        ringsAwarded: zone.rings,
        newTotal: acc.totalRings,
        globalTotal: this.totalRings
      });
    } else {
      this._log('no_accumulator', { accKey });
    }
    
    // Note: Per-user timeline tracking removed (Priority 5)
    // Rings are written to main timeline via FitnessSession.assignMetric('user:X:rings_total')
    
    // Log event in session if available
    const award = {
      userId: profileId,
      rings: zone.rings,
      zone: zone.id || zone.name,
      color: zone.color,
      userTotal: acc?.totalRings || 0,
      totalRings: this.totalRings,
      awardedAt: now,
    };
    try {
      this.sessionRef._log('ring_award', { user: accKey, ...award });
    } catch (_) { /* ignore */ }
    try { this._ringAwardCb?.(award); } catch (err) {
      this._log('ring_award_callback_error', { message: err?.message || String(err) }, 'warn');
    }
    this._notifyMutation();
  }

  get summary() {
    // Derive session timing from owning sessionRef (if available and started)
    return {
      ringTimeUnitMs: this.ringTimeUnitMs,
      totalRings: this.totalRings,
      buckets: { ...this.buckets }
    };
  }

  getUserZoneSnapshot() {
    const snapshot = [];
    this.perUser.forEach((data, key) => {
      if (!key || !data) return;
      const currentColor = data.currentColor && data.currentColor !== NO_ZONE_LABEL ? data.currentColor : null;
      const lastColor = data.lastColor && data.lastColor !== NO_ZONE_LABEL ? data.lastColor : null;
      snapshot.push({
        trackingId: key,
        user: key,
        userId: key,
        entityId: null,
        color: currentColor || lastColor || null,
        zoneId: data.lastZoneId || null,
        totalRings: data.totalRings || 0
      });
    });
    return snapshot;
  }

  /**
   * Get per-participant ring totals.
    * @returns {Map<string, number>} Map of userId -> total rings
   */
  getPerUserTotals() {
    const totals = new Map();
    this.perUser.forEach((data, key) => {
      if (!key || !data) return;
      const rings = Number.isFinite(data.totalRings) ? data.totalRings : 0;
      totals.set(key, rings);
    });
    return totals;
  }

  /**
   * Phase 2: Get totals by entity ID only (excludes legacy userId entries)
   * @returns {Map<string, number>} Map of entityId -> total rings
   */
  getEntityTotals() {
    // Strict userId mode: entities are not tracked.
    return new Map();
  }

  /**
   * DEPRECATED: getUserRingsTimeSeries removed (Priority 5)
   * Chart now uses main timeline directly via getSeries('user:X:rings_total')
   * This method is kept for backward compatibility but returns empty array.
   * @deprecated Use getSeries('user:X:rings_total') from FitnessTimeline instead
   * @param {string} userId - The user slug/id
   * @returns {number[]} - Empty array (deprecated)
   */
  getUserRingsTimeSeries(_userId) {
    getLogger().warn('treasurebox.deprecated_method_called', { method: 'getUserRingsTimeSeries' });
    return [];
  }

  /**
   * Get the cumulative total timeline (all users combined).
   * @returns {number[]} - Array of cumulative total ring values
   */
  getCumulativeTimeline() {
    return [...this._timeline.cumulative];
  }

  /**
   * DEPRECATED: Governance callback removed.
   * Governance now reads zone state from ZoneProfileStore on tick boundaries.
   * Keeping method stub for backward compatibility.
   *
   * @param {Function|null} callback
   * @deprecated
   */
  setGovernanceCallback(callback) {
    // No-op: Governance callback removed - now tick-driven via ZoneProfileStore
    if (callback) {
      getLogger().warn('treasurebox.governance_callback_deprecated', {
        message: 'Governance now reads from ZoneProfileStore on tick boundaries'
      });
    }
  }

  // REMOVED: _notifyGovernance() - no longer needed
  // Governance now runs on tick boundaries via session._collectTimelineTick()
  // and reads stable zone state from ZoneProfileStore

  /**
   * Get real-time interval progress for a user.
   * Used by chart for live edge rendering and governance for responsive evaluation.
   *
   * @param {string} userId - User ID
   * @returns {Object} Progress data including pending rings and current zone
   */
  getIntervalProgress(userId) {
    const acc = this.perUser.get(userId);
    if (!acc || !acc.currentIntervalStart) {
      return { progress: 0, pendingRings: 0, zone: null, zoneId: null, zoneColor: null, totalRings: 0, projectedTotal: 0 };
    }

    const elapsed = Date.now() - acc.currentIntervalStart;
    const progress = Math.min(1, elapsed / this.ringTimeUnitMs);
    const zone = acc.highestZone;
    const pendingRings = zone ? zone.rings * progress : 0;

    return {
      progress,              // 0-1 through interval
      pendingRings,          // interpolated rings earned so far in this interval
      zone,                  // current zone object (null if no HR)
      zoneId: acc.lastZoneId,
      zoneColor: acc.lastColor,
      totalRings: acc.totalRings || 0,
      projectedTotal: (acc.totalRings || 0) + pendingRings
    };
  }

  /**
   * Get live snapshot of all users for governance and chart.
   * Single source of truth for current zone/ring state.
   *
   * @returns {Array<Object>} Snapshot of all users with real-time state
   */
  getLiveSnapshot() {
    const snapshot = [];
    this.perUser.forEach((acc, userId) => {
      if (!userId || !acc) return;
      const progress = this.getIntervalProgress(userId);
      snapshot.push({
        userId,
        zoneId: acc.lastZoneId,
        zoneColor: acc.lastColor,
        totalRings: acc.totalRings || 0,
        projectedRings: progress.projectedTotal,
        intervalProgress: progress.progress,
        isActive: acc.highestZone !== null,
        lastHR: acc.lastHR
      });
    });
    return snapshot;
  }

  /**
   * Get memory statistics for leak detection profiling.
   * Called by FitnessApp 30-second profiler via window.__fitnessSession.
   *
   * @returns {Object} Memory stats for all TreasureBox data structures
   */
  getMemoryStats() {
    // Calculate total points in perColor timelines
    let perColorTotalPoints = 0;
    let maxColorSeriesLength = 0;
    this._timeline.perColor.forEach((series) => {
      if (Array.isArray(series)) {
        perColorTotalPoints += series.length;
        maxColorSeriesLength = Math.max(maxColorSeriesLength, series.length);
      }
    });

    return {
      // User accumulators
      perUserCount: this.perUser.size,
      
      // Timeline data
      cumulativeTimelineLength: this._timeline.cumulative.length,
      perColorCount: this._timeline.perColor.size,
      perColorTotalPoints,
      maxColorSeriesLength,
      timelineLastIndex: this._timeline.lastIndex,
      
      // Entity mapping
      deviceEntityMapSize: this._deviceEntityMap.size,
      
      // Configuration (should be stable)
      userOverridesCount: this.usersConfigOverrides.size,
      globalZonesCount: this.globalZones.length,
      bucketCount: Object.keys(this.buckets).length
    };
  }
}
