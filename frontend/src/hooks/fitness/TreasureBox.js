const NO_ZONE_LABEL = 'No Zone';

// Note: slugifyId has been removed - we now use user.id directly

export class FitnessTreasureBox {
  constructor(sessionRef) {
    this.sessionRef = sessionRef; // reference to owning FitnessSession
    this._log('constructor', { hasSessionRef: !!sessionRef });
    this.activityMonitor = null;  // ActivityMonitor for checking if user is active
    this.coinTimeUnitMs = 5000; // default; will be overridden by configuration injection
    this.globalZones = []; // array of {id,name,min,color,coins}
    this.usersConfigOverrides = new Map(); // userName -> overrides object {active,warm,hot,fire}
    this.buckets = {}; // color -> coin total
    this.totalCoins = 0;
    this.perUser = new Map(); // userName -> accumulator
    this.lastTick = Date.now(); // for elapsed computation if needed
    this._timeline = {
      perColor: new Map(),
      cumulative: [],
      lastIndex: -1
    };
    // Note: Per-user coin timelines removed (Priority 5)
    // Coins are now written directly to main timeline via assignMetric('user:X:coins_total')
    // Chart uses getSeries() to read from main timeline
    // External mutation callback (set by context) to trigger UI re-render
    this._mutationCb = null;
    this._autoInterval = null; // timer id
  }

  _log(event, data = {}) {
    console.warn(`[TreasureBox][${event}]`, data);
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
          if (!u?.name || !u?.zones) return;
          this.usersConfigOverrides.set(u.name, { ...u.zones });
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

  // Rename a user in the perUser map (used when guest assigned to preserve zone state)
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
   * @param {number} tick - Current tick index
   * @param {Set<string>} activeParticipants - Set of user IDs for users with active HR this tick
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
    const now = Date.now();
    
    for (const [userId, acc] of this.perUser.entries()) {
      // Use userId directly - activeParticipants now contains user IDs
      // CRITICAL: Only process intervals for ACTIVE participants
      // This prevents coin accumulation during dropout
      if (!activeParticipants.has(userId)) {
        this._log('user_not_active', { userId });
        // User not active - clear their highestZone to prevent stale awards
        acc.highestZone = null;
        acc.currentColor = null;
        continue;
      }
      
      if (!acc.currentIntervalStart) { acc.currentIntervalStart = now; continue; }
      const elapsed = now - acc.currentIntervalStart;
      this._log('interval_check', { userId, elapsed, coinTimeUnitMs: this.coinTimeUnitMs, hasHighestZone: !!acc.highestZone });
      if (elapsed >= this.coinTimeUnitMs) {
        if (acc.highestZone) {
          this._log('awarding_coins', { userId, zone: { id: acc.highestZone.id, name: acc.highestZone.name, coins: acc.highestZone.coins } });
          this._awardCoins(userId, acc.highestZone);
        } else {
          this._log('no_highest_zone', { userId });
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

  // Record raw HR sample for a user
  recordUserHeartRate(userId, hr) {
    this._log('record_heart_rate', { userId, hr, hasGlobalZones: this.globalZones.length > 0 });
    if (!this.globalZones.length) return; // disabled gracefully if no zones
    const now = Date.now();
    let acc = this.perUser.get(userId);
    if (!acc) {
      acc = {
        currentIntervalStart: now,
        highestZone: null, // zone object of highest seen this interval
        lastHR: null,
        currentColor: NO_ZONE_LABEL,
        lastColor: NO_ZONE_LABEL,
        lastZoneId: null,
        totalCoins: 0
      };
      this.perUser.set(userId, acc);
    }
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
    // Determine zone for this reading
    const zone = this.resolveZone(userId, hr);
    this._log('zone_resolved', { userId, hr, zone: zone ? { id: zone.id, name: zone.name, min: zone.min, coins: zone.coins } : null });
    if (zone) {
      if (!acc.highestZone || zone.min > acc.highestZone.min) {
        this._log('update_highest_zone', { userId, zone: { id: zone.id, name: zone.name } });
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
      this._log('interval_complete', { userId, elapsed, hasHighestZone: !!acc.highestZone });
      if (acc.highestZone) {
        this._awardCoins(userId, acc.highestZone);
      }
      // Start new interval after awarding (or discard if none)
      acc.currentIntervalStart = now;
      acc.highestZone = null;
      // If last HR went invalid later we'll set No Zone in HR branch; here we keep the lastColor but clear currentColor to signal awaiting new reading
      acc.currentColor = NO_ZONE_LABEL;
    }
  }

  // Note: _ensureUserTimelineIndex removed (Priority 5)
  // Per-user coin timelines are now in main timeline via user:X:coins_total

  _awardCoins(userId, zone) {
    this._log('award_coins_called', { userId, zone: zone ? { id: zone.id, name: zone.name, coins: zone.coins } : null, hasActivityMonitor: !!this.activityMonitor });
    if (!zone) return;
    
    // PRIORITY 2: Safety check - don't award coins if user is not active
    // This is a backup to processTick() which also checks activity
    if (this.activityMonitor) {
      const isActive = this.activityMonitor.isActive(userId);
      this._log('activity_check', { userId, isActive });
      if (!isActive) {
        // User is not actively broadcasting - skip award
        this._log('skip_award_inactive', { userId });
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
    const acc = this.perUser.get(userId);
    if (acc) {
      acc.totalCoins = (acc.totalCoins || 0) + zone.coins;
      acc.lastAwardedAt = now;
      this._log('coins_awarded', {
        userId,
        zone: zone.id || zone.name,
        coinsAwarded: zone.coins,
        newTotal: acc.totalCoins,
        globalTotal: this.totalCoins
      });
    } else {
      this._log('no_accumulator', { userId });
    }
    
    // Note: Per-user timeline tracking removed (Priority 5)
    // Coins are written to main timeline via FitnessSession.assignMetric('user:X:coins_total')
    
    // Log event in session if available
    try {
      this.sessionRef._log('coin_award', { user: userId, zone: zone.id || zone.name, coins: zone.coins, color: zone.color });
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
    this.perUser.forEach((data, user) => {
      if (!user || !data) return;
      const currentColor = data.currentColor && data.currentColor !== NO_ZONE_LABEL ? data.currentColor : null;
      const lastColor = data.lastColor && data.lastColor !== NO_ZONE_LABEL ? data.lastColor : null;
      snapshot.push({
        user,
        color: currentColor || lastColor || null,
        zoneId: data.lastZoneId || null
      });
    });
    return snapshot;
  }

  getPerUserTotals() {
    const totals = new Map();
    this.perUser.forEach((data, user) => {
      if (!user || !data) return;
      const coins = Number.isFinite(data.totalCoins) ? data.totalCoins : 0;
      totals.set(user, coins);
    });
    return totals;
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
    console.warn('[TreasureBox] getUserCoinsTimeSeries is deprecated - use getSeries() from timeline');
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
