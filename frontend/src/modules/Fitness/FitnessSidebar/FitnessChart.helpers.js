import { 
  ParticipantStatus, 
  ZoneColors, 
  isDropout, 
  createChartSegment,
  getZoneColor 
} from '../domain';

export const MIN_VISIBLE_TICKS = 30;

// Re-export for backward compatibility - prefer importing from domain
export const ZONE_COLOR_MAP = ZoneColors;

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// Note: slugifyId has been removed - we now use explicit IDs from config

/**
 * Normalize participant ID from roster entry
 * Prefers explicit canonical IDs (id, profileId) over fallbacks (name, hrDeviceId)
 * Logs warnings when falling back to non-canonical IDs for debugging
 * 
 * @param {Object} entry - Roster entry
 * @returns {string | null} - Canonical ID or null
 * @see /docs/reviews/guest-assignment-service-audit.md Issue #3
 */
const normalizeId = (entry) => {
  if (!entry) return null;
  
  // Prefer explicit canonical ID
  const canonicalId = entry.id || entry.profileId;
  if (canonicalId) return canonicalId;
  
  // Log fallback usage for debugging (Issue #3 remediation)
  const fallbackId = entry.name || entry.hrDeviceId || null;
  if (fallbackId) {
    console.warn('[FitnessChart.helpers] No canonical ID, using fallback:', {
      name: entry.name,
      hrDeviceId: entry.hrDeviceId,
      resolvedId: fallbackId
    });
  }
  return fallbackId;
};

const forwardFill = (arr = []) => {
  if (!Array.isArray(arr)) return arr;
  let last = null;
  return arr.map((v) => {
    if (Number.isFinite(v)) {
      last = v;
      return v;
    }
    return last;
  });
};

const forwardBackwardFill = (arr = []) => {
  if (!Array.isArray(arr)) return arr;
  const fwd = forwardFill(arr);
  // Back-fill leading nulls with first finite value if any
  let firstFinite = fwd.find((v) => Number.isFinite(v)) ?? null;
  return fwd.map((v) => (v == null ? firstFinite : v));
};

/**
 * Preserves interior nulls (dropouts) while filling only leading/trailing edges.
 * This allows buildSegments to detect actual user dropouts.
 * 
 * @param {Array} arr - Array of values
 * @param {Object} [options] - Options
 * @param {boolean} [options.startAtZero=false] - If true, ensure index 0 is always 0 (for race chart origin)
 */
const fillEdgesOnly = (arr = [], options = {}) => {
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  const { startAtZero = false } = options;
  
  // Find first and last finite indices
  let firstFiniteIdx = -1;
  let lastFiniteIdx = -1;
  for (let i = 0; i < arr.length; i++) {
    if (Number.isFinite(arr[i])) {
      if (firstFiniteIdx === -1) firstFiniteIdx = i;
      lastFiniteIdx = i;
    }
  }
  
  if (firstFiniteIdx === -1) return arr; // All nulls
  
  const result = [...arr];
  const firstValue = arr[firstFiniteIdx];
  const lastValue = arr[lastFiniteIdx];
  
  // For cumulative metrics (startAtZero=true):
  // - Force index 0 to be 0 so all lines start at origin
  // - Back-fill any other leading nulls with 0
  if (startAtZero) {
    result[0] = 0; // Anchor to origin - everyone starts at 0
    for (let i = 1; i < firstFiniteIdx; i++) {
      result[i] = 0;
    }
  } else {
    // Original behavior: back-fill with first value
    for (let i = 0; i < firstFiniteIdx; i++) {
      result[i] = firstValue;
    }
  }
  
  // Forward-fill trailing nulls only  
  for (let i = lastFiniteIdx + 1; i < arr.length; i++) {
    result[i] = lastValue;
  }
  
  // Interior nulls are preserved to indicate dropout periods
  return result;
};

/**
 * Build activity mask from heart rate series.
 * This is extracted as a utility for use with or without ActivityMonitor.
 * 
 * @param {Array} heartRateSeries 
 * @returns {boolean[]}
 */
export const buildActivityMaskFromHeartRate = (heartRateSeries) => {
  if (!Array.isArray(heartRateSeries)) return [];
  return heartRateSeries.map(hr => hr != null && Number.isFinite(hr) && hr > 0);
};

/**
 * Build beats series data for chart rendering.
 * 
 * Phase 5: Now supports entity-based series lookup when rosterEntry has entityId.
 * Falls back to user-based series for backward compatibility.
 * 
 * @param {Object} rosterEntry - Participant entry with profileId/name and optional entityId
 * @param {Function} getSeries - Function to retrieve timeline series (userId, metric, options)
 * @param {Object} [timebase] - Timebase configuration
 * @param {Object} [options] - Additional options
 * @param {import('../domain').ActivityMonitor} [options.activityMonitor] - Optional ActivityMonitor for centralized activity tracking
 * @param {Function} [options.getEntitySeries] - Optional function to get entity series directly
 * @returns {{ beats: number[], zones: (string|null)[], active: boolean[] }}
 */
export const buildBeatsSeries = (rosterEntry, getSeries, timebase = {}, options = {}) => {
  const targetId = normalizeId(rosterEntry);
  if (!targetId || typeof getSeries !== 'function') return { beats: [], zones: [], active: [] };

  // For grace period transfer: use original user's timeline data (Jin displays Soren's line)
  const timelineUserId = rosterEntry?.timelineUserId || rosterEntry?.metadata?.timelineUserId || targetId;
  
  // Phase 5: Check if roster entry has entityId for entity-based lookup
  const entityId = rosterEntry?.entityId || null;
  const { getEntitySeries } = options;
  
  // Helper to get series - tries entity series first if available
  const getSeriesForParticipant = (metric, seriesOptions = {}) => {
    // If we have entityId and getEntitySeries function, prefer entity series
    if (entityId && typeof getEntitySeries === 'function') {
      const entitySeries = getEntitySeries(entityId, metric, seriesOptions);
      if (Array.isArray(entitySeries) && entitySeries.length > 0) {
        return entitySeries;
      }
    }
    // Fall back to user-based series (use timelineUserId for grace period transfers)
    const userSeries = getSeries(timelineUserId, metric, seriesOptions) || [];
    return userSeries;
  };

  const intervalMs = Number(timebase?.intervalMs) > 0 ? Number(timebase.intervalMs) : 5000;
  const zones = getSeriesForParticipant('zone_id', { clone: true });
  
  // Get heart_rate to detect actual device activity (has nulls during dropout)
  const heartRate = getSeriesForParticipant('heart_rate', { clone: true });
  
  // HR nulls tracking (silent - only log at debug level if needed)
  const hrNullCount = heartRate.filter(v => v == null).length;
  
  const maxLen = Math.max(zones.length, heartRate.length);
  let active = new Array(maxLen).fill(false);

  // Preferred source: ActivityMonitor (single source of truth for inactivity/dropout)
  if (options.activityMonitor && targetId) {
    const mask = options.activityMonitor.getActivityMask(targetId, maxLen - 1) || [];
    for (let i = 0; i < maxLen; i++) {
      active[i] = mask[i] === true;
    }
  } else {
    // Fallback: derive activity from heart_rate nulls
    for (let i = 0; i < maxLen; i++) {
      const hr = heartRate[i];
      active[i] = hr != null && Number.isFinite(hr) && hr > 0;
    }
  }

  // CRITICAL FIX: If roster says user is currently inactive (roster.isActive === false),
  // ensure the active array reflects this. This syncs ActivityMonitor with DeviceManager.
  // DeviceManager is the source of truth for current activity status.
  if (rosterEntry && rosterEntry.isActive === false) {
    // Find the last tick where user was truly active
    let lastActiveTick = -1;
    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i] === true) {
        lastActiveTick = i;
        break;
      }
    }
    // If ActivityMonitor shows user as active at recent ticks but roster says inactive,
    // mark trailing ticks as inactive to trigger gap detection
    // This handles the case where DeviceManager detected dropout before ActivityMonitor
    if (lastActiveTick >= 0 && lastActiveTick === active.length - 1) {
      // ActivityMonitor thinks user is still active, but DeviceManager disagrees
      // Force the last tick to be inactive to start gap detection
      active[active.length - 1] = false;
    }
  }

  // Primary source: coins_total from TreasureBox (single source of truth)
  // Phase 5: Uses entity series when available
  const coinsRaw = getSeriesForParticipant('coins_total', { clone: true });
  
  if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
    // Apply Math.floor for consistency with TreasureBox accumulator
    // Use startAtZero to anchor cumulative values to origin (0,0)
    const beats = fillEdgesOnly(coinsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)), { startAtZero: true });
    return { beats, zones, active };
  }

  // Secondary source: pre-computed heart_beats if available
  const beatsRaw = getSeriesForParticipant('heart_beats', { clone: true });
  if (Array.isArray(beatsRaw) && beatsRaw.length > 0) {
    // Apply Math.floor for consistency
    // Use startAtZero to anchor cumulative values to origin (0,0)
    const beats = fillEdgesOnly(beatsRaw.map((v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : null)), { startAtZero: true });
    return { beats, zones, active };
  }

  // Defensive logging: no series data found (Issue #3 remediation)
  // This indicates ID mismatch between timeline recording and chart lookup
  if (!Array.isArray(heartRate) || heartRate.length === 0) {
    console.warn('[FitnessChart.helpers] No series data found for participant:', {
      targetId,
      name: rosterEntry?.name || rosterEntry?.displayLabel,
      hrDeviceId: rosterEntry?.hrDeviceId,
      coinsRaw: coinsRaw?.length ?? 0,
      beatsRaw: beatsRaw?.length ?? 0,
      heartRateLen: heartRate?.length ?? 0
    });
    return { beats: [], zones: [], active: [] };
  }

  // Last resort fallback: compute from heart_rate (deprecated)
  if (process.env.NODE_ENV === 'development') {
    console.warn(`[FitnessChart] Falling back to heart_rate calculation for ${targetId} - consider using TreasureBox coins_total`);
  }
  const beats = [];
  let total = 0;
  const intervalSeconds = intervalMs / 1000;
  heartRate.forEach((hr, idx) => {
    const hrVal = toNumber(hr);
    if (hrVal != null && hrVal > 0) {
      total += (hrVal / 60) * intervalSeconds;
    }
    beats[idx] = Math.floor(total);
  });
  return { beats, zones, active };
};

/**
 * Build chart segments from beats/zones/active arrays.
 * 
 * @param {number[]} beats - Cumulative beat values per tick
 * @param {(string|null)[]} zones - Zone IDs per tick
 * @param {boolean[]} active - Activity status per tick (true = broadcasting)
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.isCurrentlyActive] - Whether user is currently active according to roster (for immediate gap extension on rejoin)
 * @param {number} [options.currentTick] - Current tick index for extending gap to present
 * @returns {Object[]} Array of segment objects
 */
export const buildSegments = (beats = [], zones = [], active = [], options = {}) => {
  const { isCurrentlyActive, currentTick } = options;
  const segments = [];
  let current = null;
  let lastZone = null;
  let lastPoint = null;
  let gapStartPoint = null; // Track where a dropout started
  let inGap = false; // Track if we're currently in a dropout period

  // DEBUG: Check if active array has any false values
  const falseCount = active.filter((a, i) => i > 0 && a === false).length;
  
  // Find first ACTIVE tick (when user actually started broadcasting)
  let firstActiveTick = -1;
  for (let i = 0; i < active.length; i++) {
    if (active[i] === true) {
      firstActiveTick = i;
      break;
    }
  }

  const pushCurrent = () => {
    if (current && current.points.length > 0) {
      segments.push(current);
    }
    current = null;
  };

  for (let i = 0; i < beats.length; i += 1) {
    const value = toNumber(beats[i]);
    const zoneRaw = zones?.[i] ?? null;
    // Dropout detection: ONLY based on heart_rate presence (active array)
    // active[i] is false when heart_rate was null at tick i
    const isActiveAtTick = active[i] === true;
    
    // LATE JOIN HANDLING: Leading zeros (before first active tick) should be drawn
    // to anchor the line at origin, NOT treated as dropout
    const isLeadingZero = i < firstActiveTick && value === 0;
    
    // Determine participant status at this tick
    // ONLY consider it dropout if active[i] is false (no HR data recorded)
    // EXCEPT for leading zeros which are synthetic anchors
    const tickStatus = value == null 
      ? ParticipantStatus.ABSENT 
      : (isActiveAtTick || isLeadingZero ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE);
    
    if (tickStatus === ParticipantStatus.ABSENT) {
      // No beats data at all - start tracking dropout gap if we have a last known point
      if (lastPoint && !gapStartPoint) {
        gapStartPoint = { ...lastPoint };
        inGap = true;
      }
      pushCurrent();
      continue;
    }
    
    // User has beats data - check if they're in dropout (IDLE status = no HR)
    if (isDropout(tickStatus)) {
      // User dropped out (no HR) but beats data continues (cumulative value frozen)
      // Start gap tracking at the point where they dropped
      if (!gapStartPoint && lastPoint) {
        gapStartPoint = { ...lastPoint };
      }
      inGap = true;
      // Don't add to current segment - skip this point as it's during dropout
      continue;
    }
    
    // User is active (ACTIVE status - HR data broadcasting)
    if (inGap && gapStartPoint) {
      // Returning from dropout - create HORIZONTAL gap segment
      // The gap is purely horizontal at the dropout value
      // Any vertical jump is part of the COLORED segment (user earned coins after rejoining)
      // This correctly shows: dropout value stayed flat, then jumps to current value
      const gapSegment = {
        zone: null,
        color: getZoneColor(null),
        status: ParticipantStatus.IDLE,
        isGap: true,
        points: [
          { ...gapStartPoint },           // Left: dropout point (tick N, value V)
          { i, v: gapStartPoint.v }       // Right: same Y, at rejoin tick (horizontal only)
        ]
      };
      segments.push(gapSegment);
      
      // Set lastPoint to the gap end so colored segment connects there
      // The colored segment will then jump to the actual current value
      lastPoint = { i, v: gapStartPoint.v };
      gapStartPoint = null;
      inGap = false;
    }
    
    const zone = zoneRaw || lastZone || null;
    const color = getZoneColor(zone);
    
    if (!current || current.zone !== zone) {
      pushCurrent();
      // Create segment with explicit status
      current = { 
        zone, 
        color, 
        status: ParticipantStatus.ACTIVE,
        isGap: false, 
        points: [] 
      };
      // Include prior point to maintain continuity across color changes (but not after gaps)
      if (lastPoint) {
        current.points.push({ ...lastPoint });
      }
    }
    lastZone = zone;
    current.points.push({ i, v: value });
    lastPoint = { i, v: value };
  }
  pushCurrent();
  
  // IMMEDIATE GAP EXTENSION ON REJOIN:
  // If roster says user is currently active but we're still in a gap (timeline hasn't caught up),
  // extend the gap segment to the current tick so the grey line appears immediately
  if (inGap && gapStartPoint && isCurrentlyActive === true) {
    const extendToTick = currentTick ?? beats.length - 1;
    if (extendToTick > gapStartPoint.i) {
      const gapSegment = {
        zone: null,
        color: getZoneColor(null),
        status: ParticipantStatus.IDLE,
        isGap: true,
        points: [
          { ...gapStartPoint },           // Left: dropout point
          { i: extendToTick, v: gapStartPoint.v }  // Right: extend to current tick (horizontal)
        ]
      };
      segments.push(gapSegment);
      inGap = false;
      gapStartPoint = null;
    }
  }
  
  // Debug: Log segments including gaps and active array status
  const gapSegs = segments.filter(s => s.isGap === true);
  const activeFalseCount = active.filter(a => a === false).length;
  const activeLen = active.length;
  if (activeFalseCount > 0 || gapSegs.length > 0) {
    console.log('[buildSegments] DEBUG:', { 
      totalSegs: segments.length, 
      gapSegs: gapSegs.length,
      activeFalseCount,
      activeLen,
      firstFalseIdx: active.indexOf(false),
      lastFalseIdx: active.lastIndexOf(false)
    });
  }
  
  return segments;
};

export const createPaths = (segments = [], options = {}) => {
  const {
    width = 600,
    height = 240,
    minVisibleTicks = MIN_VISIBLE_TICKS,
    margin = { top: 0, right: 0, bottom: 0, left: 0 },
    effectiveTicks: effectiveTicksOverride,
    yScaleBase = 1,
    minValue = 0,
    bottomFraction = 1,
    topFraction = 0
  } = options;

  const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
  const innerHeight = Math.max(1, height - (margin.top || 0) - (margin.bottom || 0));

  const mergedSegments = (() => {
    const merged = [];
    segments.forEach((seg) => {
      if (!seg || !Array.isArray(seg.points) || seg.points.length === 0) return;
      const prev = merged[merged.length - 1];
      // Only merge if same color AND same gap status (don't merge gap with non-gap)
      if (prev && prev.color === seg.color && prev.isGap === seg.isGap) {
        prev.points.push(...seg.points);
      } else {
        merged.push({ ...seg, points: [...seg.points] });
      }
    });
    return merged;
  })();

  let maxValue = options.maxValue || 0;
  let maxIndex = 0;
  mergedSegments.forEach((seg) => {
    seg.points.forEach(({ i, v }) => {
      if (v > maxValue) maxValue = v;
      if (i > maxIndex) maxIndex = i;
    });
  });
  if (segments.length === 0) return [];
  if (!(maxValue > 0)) {
    maxValue = 1; // ensure drawable domain even when all values are zero
  }

  const effectiveTicks = Math.max(minVisibleTicks, effectiveTicksOverride || maxIndex + 1, 1);
  const scaleX = (i) => {
    if (effectiveTicks <= 1) return 0;
    const clampedIndex = Math.max(0, i);
    return Math.max(0, (margin.left || 0) + (clampedIndex / (effectiveTicks - 1)) * innerWidth);
  };
  const domainMin = Math.min(minValue, maxValue);
  const domainSpan = Math.max(1, maxValue - domainMin);
  const topFrac = Math.max(0, Math.min(1, topFraction));
  const bottomFrac = Math.max(topFrac, Math.min(1, bottomFraction));

  const defaultScaleY = (v) => {
    const clamped = Math.max(domainMin, Math.min(maxValue, v));
    const norm = (clamped - domainMin) / domainSpan;
    let mapped = norm;
    if (yScaleBase > 1) {
      mapped = 1 - Math.log(1 + (1 - norm) * (yScaleBase - 1)) / Math.log(yScaleBase);
    }
    const frac = bottomFrac + (topFrac - bottomFrac) * mapped;
    return (margin.top || 0) + frac * innerHeight;
  };

  const scaleY = options.scaleY || defaultScaleY;

  // Debug: log gap segments being rendered
  const gapsToRender = mergedSegments.filter(s => s.isGap);
  if (gapsToRender.length > 0) {
    console.log('[createPaths] Rendering gap segments:', gapsToRender.length, gapsToRender.map(g => ({
      isGap: g.isGap,
      points: g.points,
      color: g.color
    })));
  }

  return mergedSegments.map((seg) => {
    const points = seg.points.length === 1 ? [...seg.points, seg.points[0]] : seg.points;
    const path = points.reduce((acc, { i, v }, idx) => {
      const x = scaleX(i).toFixed(2);
      const y = scaleY(v).toFixed(2);
      return acc + `${idx === 0 ? 'M' : 'L'}${x},${y} `;
    }, '').trim();
    // Gap segments (dropout) get reduced opacity and dashed stroke
    const segIsGap = Boolean(seg.isGap) || isDropout(seg.status);
    const defaultColor = getZoneColor(null);
    return {
      zone: seg.zone,
      color: seg.color,
      status: seg.status || (segIsGap ? ParticipantStatus.IDLE : ParticipantStatus.ACTIVE),
      opacity: segIsGap ? 0.5 : (seg.color === defaultColor ? 0.1 : 1),
      isGap: segIsGap,
      d: path
    };
  });
};
