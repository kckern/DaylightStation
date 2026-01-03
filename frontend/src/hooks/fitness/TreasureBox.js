const NO_ZONE_LABEL = 'No Zone';
import getLogger from '../../lib/logging/Logger.js';

// Strict identifier contract: TreasureBox is keyed by userId.
// - perUser Map is keyed by userId
// - processTick() receives activeParticipants Set containing userIds
// - profileId is preserved on accumulator for legacy/compat lookups only

export class FitnessTreasureBox {
  constructor(sessionRef) {
    this.sessionRef = sessionRef; // reference to owning FitnessSession
    this._log('constructor', { hasSessionRef: !!sessionRef });
    this.activityMonitor = null;  // ActivityMonitor for checking if user is active
    this.coinTimeUnitMs = 5000; // default; will be overridden by configuration injection
    this.globalZones = []; // array of {id,name,min,color,coins}
    this.usersConfigOverrides = new Map(); // userId -> overrides object {active,warm,hot,fire}
    this.buckets = {}; // color -> coin total
    this.totalCoins = 0;
    this.perUser = new Map(); // userId -> accumulator
    this.lastTick = Date.now(); // for elapsed computation if needed
    this._timeline = {
      perColor: new Map(),
      cumulative: [],
      lastIndex: -1
    };
    // Compatibility: device -> entity mapping retained, but strict mode ignores entityId for accounting.
    this._deviceEntityMap = new Map(); // deviceId -> entityId
    // Note: Per-user coin timelines removed (Priority 5)
    // Coins are now written directly to main timeline via assignMetric('user:X:coins_total')
    // Chart uses getSeries() to read from main timeline
    // External mutation callback (set by context) to trigger UI re-render
    this._mutationCb = null;
    this._autoInterval = null; // timer id
  }

  _log(event, data = {}) {
    getLogger().warn(`treasurebox.${event}`, data);
    try {
      if (this.sessionRef?._log) {
        this.sessionRef._log(`treasurebox_${event}`, data);
      }
    } catch (_) { /* ignore */ }
  }

  /**
   * Set the ActivityMonitor for activity-aware coin processing
   * @param {import('../../modules/Fitness/domain/ActivityMonitor.js').ActivityMonitor} monitor
   */
  setActivityMonitor(monitor) {
    this.activityMonitor = monitor;
  }

  setMutationCallback(cb) { this._mutationCb = typeof cb === 'function' ? cb : null; }
  _notifyMutation() { if (this._mutationCb) { try { this._mutationCb(); } catch(_){} } }

  configure({ coinTimeUnitMs, zones, users }) {
    // Note: _userTimelines removed (Priority 5) - coins written to main timeline
    
    if (typeof coinTimeUnitMs === 'number' && coinTimeUnitMs > 0) {
      this.coinTimeUnitMs = coinTimeUnitMs;
    }
    if (this.sessionRef?.timebase) {
      this.sessionRef.timebase.intervalMs = this.coinTimeUnitMs;
    }
    if (Array.isArray(zones)) {
      // Normalize zones sorted by min ascending for evaluation (we'll iterate descending)
      this.globalZones = zones.map(z => ({
        id: z.id,
        name: z.name,
        min: Number(z.min) || 0,
        color: z.color,
        coins: Number(z.coins) || 0
      })).sort((a,b) => a.min - b.min);
      // Initialize bucket colors
      for (const z of this.globalZones) {
        if (!(z.color in this.buckets)) this.buckets[z.color] = 0;
        if (!this._timeline.perColor.has(z.color)) {
          this._timeline.perColor.set(z.color, []);
        }
      }
    }
    // Extract user overrides (provided as part of users.primary/secondary config shape)
    if (users) {
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
        });
      };
      if (Array.isArray(users)) {
        collectOverrides(users);
      } else if (typeof users === 'object') {
        Object.values(users).forEach((value) => collectOverrides(value));
      }
    }
    // Backfill existing users with zone data
    this._backfillExistingUsers();
    // NOTE: Timer removed - TreasureBox is now tick-driven via processTick()
    // This eliminates race conditions between coin awards and dropout detection
  }

  // DEPRECATED: Timer-based processing removed to fix race conditions
  // TreasureBox is now driven by FitnessSession._collectTimelineTick() via processTick()
  _startAutoTicker() {
    // No-op: timer-based processing has been removed
    // Coin processing now happens synchronously during session tick
    this._log('auto_ticker_disabled', { usingTickDriven: true });
  }

  stop() { if (this._autoInterval) { clearInterval(this._autoInterval); this._autoInterval = null; } }

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
      totalCoins: 0
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

  // Backfill highestZone from lastHR so already-on monitors immediately accrue coins
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
   * Process coin intervals for active participants only.
   * Called synchronously from FitnessSession._collectTimelineTick() to ensure
   * coin processing is aligned with session ticks and dropout detection.
   *
    * Strict mode: activeParticipants contains userIds, matching the keys in perUser Map.
   *
   * @param {number} tick - Current tick index
    * @param {Set<string>} activeParticipants - Set of userIds for active participants
   * @param {Object} options - Additional options (legacy, no longer used)
   */
  processTick(tick, activeParticipants, options = {}) {
    this._log('process_tick', {
      tick,
      perUserSize: this.perUser.size,
      activeParticipants: Array.from(activeParticipants),
      coinTimeUnitMs: this.coinTimeUnitMs,
      perUserKeys: Array.from(this.perUser.keys())
    });
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
      // This prevents coin accumulation during dropout
      // Phase 4: Simplified - activeParticipants and perUser use same ID scheme
      if (!activeParticipants.has(accKey)) {
        this._log('user_not_active', { userId: accKey, profileId });
        // User not active - clear their highestZone to prevent stale awards
        acc.highestZone = null;
        acc.currentColor = null;
        continue;
      }
      
      if (!acc.currentIntervalStart) { acc.currentIntervalStart = now; continue; }
      const elapsed = now - acc.currentIntervalStart;
      this._log('interval_check', { accKey, elapsed, coinTimeUnitMs: this.coinTimeUnitMs, hasHighestZone: !!acc.highestZone });
      if (elapsed >= this.coinTimeUnitMs) {
        if (acc.highestZone) {
          this._log('awarding_coins', { accKey, zone: { id: acc.highestZone.id, name: acc.highestZone.name, coins: acc.highestZone.coins } });
          this._awardCoins(accKey, acc.highestZone);
        } else {
          this._log('no_highest_zone', { accKey });
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
      totalCoins: this.totalCoins
    };
  }

  // Determine zone for HR for a given user, returns zone object or null
  resolveZone(userId, hr) {
    if (!hr || hr <= 0 || this.globalZones.length === 0) return null;
    // Build effective thresholds using overrides where present
    const overrides = this.usersConfigOverrides.get(userId) || {};
    // Map of zone.id -> threshold min override (matching id by name semantics: active/warm/hot/fire)
    // We'll evaluate global zones but swap min if override present (by zone.id OR zone.name lowercased)
    const zonesDescending = [...this.globalZones].sort((a,b) => b.min - a.min);
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
    this._log('record_heart_rate', { 
      entityOrUserId, 
      hr, 
      profileId,
      hasGlobalZones: this.globalZones.length > 0,
      isEntityId
    });
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
    this._log('zone_resolved', { 
      accKey, 
      profileId,
      hr, 
      zone: zone ? { id: zone.id, name: zone.name, min: zone.min, coins: zone.coins } : null 
    });
    if (zone) {
      if (!acc.highestZone || zone.min > acc.highestZone.min) {
        this._log('update_highest_zone', { accKey, zone: { id: zone.id, name: zone.name } });
        acc.highestZone = zone;
        acc.currentColor = zone.color;
        acc.lastColor = zone.color; // update persistent last color
        acc.lastZoneId = zone.id || zone.name || null;
      }
    }
    acc.lastHR = hr;
    
    // Check interval completion
    const elapsed = now - acc.currentIntervalStart;
    if (elapsed >= this.coinTimeUnitMs) {
      this._log('interval_complete', { accKey, elapsed, hasHighestZone: !!acc.highestZone });
      if (acc.highestZone) {
        this._awardCoins(accKey, acc.highestZone);
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
      getLogger().warn('fitness.treasure.no_entity_mapped', {
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
  // Per-user coin timelines are now in main timeline via user:X:coins_total

  _awardCoins(accKey, zone) {
    this._log('award_coins_called', { accKey, zone: zone ? { id: zone.id, name: zone.name, coins: zone.coins } : null, hasActivityMonitor: !!this.activityMonitor });
    if (!zone) return;
    
    const acc = this.perUser.get(accKey);
    const profileId = acc?.profileId || accKey;
    
    // PRIORITY 2: Safety check - don't award coins if user is not active
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
    this.buckets[zone.color] += zone.coins;
    this.totalCoins += zone.coins;
    const start = this.sessionRef?.startTime || this.sessionRef?.timebase?.startAbsMs || Date.now();
    const intervalMs = this.coinTimeUnitMs > 0 ? this.coinTimeUnitMs : 5000;
    const now = Date.now();
    const intervalIndex = Math.floor(Math.max(0, now - start) / intervalMs);
    this._ensureTimelineIndex(intervalIndex, zone.color);
    const colorSeries = this._timeline.perColor.get(zone.color);
    if (colorSeries) {
      colorSeries[intervalIndex] += zone.coins;
    }
    if (this._timeline.cumulative.length > intervalIndex) {
      this._timeline.cumulative[intervalIndex] += zone.coins;
    }
    this._timeline.lastIndex = Math.max(this._timeline.lastIndex, intervalIndex);
    if (this.sessionRef?.timebase && intervalIndex + 1 > this.sessionRef.timebase.intervalCount) {
      this.sessionRef.timebase.intervalCount = intervalIndex + 1;
    }
    // acc already retrieved above for profileId lookup
    if (acc) {
      acc.totalCoins = (acc.totalCoins || 0) + zone.coins;
      acc.lastAwardedAt = now;
      this._log('coins_awarded', {
        accKey,
        profileId,
        zone: zone.id || zone.name,
        coinsAwarded: zone.coins,
        newTotal: acc.totalCoins,
        globalTotal: this.totalCoins
      });
    } else {
      this._log('no_accumulator', { accKey });
    }
    
    // Note: Per-user timeline tracking removed (Priority 5)
    // Coins are written to main timeline via FitnessSession.assignMetric('user:X:coins_total')
    
    // Log event in session if available
    try {
      this.sessionRef._log('coin_award', { user: accKey, profileId, zone: zone.id || zone.name, coins: zone.coins, color: zone.color });
    } catch (_) { /* ignore */ }
    this._notifyMutation();
  }

  get summary() {
    // Derive session timing from owning sessionRef (if available and started)
    return {
      coinTimeUnitMs: this.coinTimeUnitMs,
      totalCoins: this.totalCoins,
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
        totalCoins: data.totalCoins || 0
      });
    });
    return snapshot;
  }

  /**
   * Get per-participant coin totals.
    * @returns {Map<string, number>} Map of userId -> total coins
   */
  getPerUserTotals() {
    const totals = new Map();
    this.perUser.forEach((data, key) => {
      if (!key || !data) return;
      const coins = Number.isFinite(data.totalCoins) ? data.totalCoins : 0;
      totals.set(key, coins);
    });
    return totals;
  }

  /**
   * Phase 2: Get totals by entity ID only (excludes legacy userId entries)
   * @returns {Map<string, number>} Map of entityId -> total coins
   */
  getEntityTotals() {
    // Strict userId mode: entities are not tracked.
    return new Map();
  }

  /**
   * DEPRECATED: getUserCoinsTimeSeries removed (Priority 5)
   * Chart now uses main timeline directly via getSeries('user:X:coins_total')
   * This method is kept for backward compatibility but returns empty array.
   * @deprecated Use getSeries('user:X:coins_total') from FitnessTimeline instead
   * @param {string} userId - The user slug/id
   * @returns {number[]} - Empty array (deprecated)
   */
  getUserCoinsTimeSeries(userId) {
    getLogger().warn('treasurebox.deprecated_method_called', { method: 'getUserCoinsTimeSeries' });
    return [];
  }

  /**
   * Get the cumulative total timeline (all users combined).
   * @returns {number[]} - Array of cumulative total coin values
   */
  getCumulativeTimeline() {
    return [...this._timeline.cumulative];
  }
}
