/**
 * ChartDataBuilder - Clean Interface for Chart Data Generation
 * 
 * Encapsulates all data transformation logic for fitness charts:
 * - Fetching timeline series data
 * - Building activity masks
 * - Creating chart segments with dropout detection
 * - Generating SVG paths
 * 
 * Consumers don't need to know about:
 * - coins_total vs heart_beats series
 * - Forward-filling behavior
 * - Activity mask generation from heart_rate
 * - Segment merging and gap detection
 * 
 * @see /docs/notes/fitness-architecture-review.md Phase 3
 */

import { 
  ParticipantStatus, 
  createActivityPeriod,
  getZoneColor,
  isDropout
} from './types.js';

/**
 * Default zone color map
 */
const ZONE_COLOR_MAP = {
  cool: '#4fb1ff',
  active: '#4ade80',
  warm: '#facc15',
  hot: '#fb923c',
  fire: '#f87171',
  default: '#9ca3af'
};

/**
 * Minimum visible ticks for chart rendering
 */
const MIN_VISIBLE_TICKS = 30;

/**
 * @typedef {Object} ChartDataPoint
 * @property {number} i - Tick index
 * @property {number} v - Value
 */

/**
 * @typedef {Object} ChartSegment
 * @property {string|null} zone - HR zone name
 * @property {string} color - Stroke color
 * @property {import('./types.js').ParticipantStatusValue} status - Activity status
 * @property {boolean} isGap - Whether this is a dropout gap
 * @property {ChartDataPoint[]} points - Data points
 */

/**
 * @typedef {Object} ChartPath
 * @property {string|null} zone - HR zone name
 * @property {string} color - Stroke color
 * @property {import('./types.js').ParticipantStatusValue} status - Activity status
 * @property {number} opacity - Stroke opacity
 * @property {boolean} isGap - Whether this is a dropout gap
 * @property {string} d - SVG path data
 */

/**
 * @typedef {Object} ParticipantChartData
 * @property {string} id - Participant ID
 * @property {string} name - Display name
 * @property {string} profileId - Profile ID for avatar lookup
 * @property {string|null} avatarUrl - Avatar URL
 * @property {string} color - Current zone color
 * @property {number[]} beats - Cumulative beats array
 * @property {(string|null)[]} zones - Zone array
 * @property {boolean[]} active - Activity mask
 * @property {ChartSegment[]} segments - Chart segments
 * @property {number} firstActiveTick - First tick where HR was present
 * @property {number} maxVal - Maximum beats value
 * @property {number} lastIndex - Last valid tick index
 * @property {import('./types.js').ParticipantStatusValue} status - Current status
 */

/**
 * @typedef {ParticipantChartData} ChartParticipant
 * Alias used for clarity when returning chart-ready participant data.
 */

/**
 * ChartDataBuilder - Encapsulates chart data transformation logic
 */
export class ChartDataBuilder {
  /**
   * @param {Object} options
   * @param {Function} options.getSeries - Timeline series getter: (id, metric, options) => array
   * @param {Object} [options.timebase] - Timeline timebase config
   * @param {import('./ActivityMonitor.js').ActivityMonitor} [options.activityMonitor] - Activity monitor instance
   */
  constructor(options = {}) {
    this._getSeries = options.getSeries;
    this._timebase = options.timebase || {};
    this._activityMonitor = options.activityMonitor;
    this._intervalMs = Number(this._timebase?.intervalMs) > 0 ? Number(this._timebase.intervalMs) : 5000;
  }

  /**
   * Update configuration
   * @param {Object} options 
   */
  configure(options = {}) {
    if (options.getSeries) this._getSeries = options.getSeries;
    if (options.timebase) {
      this._timebase = options.timebase;
      this._intervalMs = Number(this._timebase?.intervalMs) > 0 ? Number(this._timebase.intervalMs) : 5000;
    }
    if (options.activityMonitor !== undefined) this._activityMonitor = options.activityMonitor;
  }

  /**
   * Get chart data for a single participant.
   * This is the main interface method - consumers call this instead of
   * manually calling buildBeatsSeries + buildSegments.
   * 
   * @param {Object} participant - Participant entry from roster
   * @param {string} [participant.profileId]
   * @param {string} [participant.name]
   * @param {string} [participant.displayLabel]
   * @param {string} [participant.id]
   * @param {string} [participant.avatarUrl]
   * @param {string} [participant.zoneColor]
   * @returns {ParticipantChartData|null}
   */
  getParticipantData(participant) {
    if (!participant || typeof this._getSeries !== 'function') return null;

    const targetId = this._normalizeId(participant);
    if (!targetId) return null;

    // Build series data
    const { beats, zones, active, firstActiveTick } = this._buildBeatsSeries(targetId);
    if (!beats.length) return null;

    // Build segments
    const segments = this._buildSegments(beats, zones, active);
    if (!segments.length) return null;

    // Calculate metrics
    const maxVal = Math.max(0, ...beats.filter((v) => Number.isFinite(v)));
    if (maxVal <= 0) return null;

    let lastIndex = -1;
    for (let i = beats.length - 1; i >= 0; i--) {
      if (Number.isFinite(beats[i])) {
        lastIndex = i;
        break;
      }
    }

    // Determine current status
    const status = this._activityMonitor 
      ? this._activityMonitor.getStatus(targetId)
      : (active[active.length - 1] ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE);

    const profileId = participant.profileId || participant.hrDeviceId || targetId;

    return {
      id: participant.id || profileId || targetId,
      name: participant.displayLabel || participant.name || 'Unknown',
      profileId,
      avatarUrl: participant.avatarUrl || null,
      color: participant.zoneColor || ZONE_COLOR_MAP.default,
      beats,
      zones,
      active,
      segments,
      firstActiveTick: Number.isInteger(firstActiveTick) ? firstActiveTick : -1,
      maxVal,
      lastIndex,
      status
    };
  }

  /**
   * Get chart data for multiple participants.
   * Filters out invalid entries automatically.
   * 
   * @param {Object[]} participants - Array of participant entries
   * @returns {ParticipantChartData[]}
   */
  getAllParticipantsData(participants) {
    if (!Array.isArray(participants)) return [];
    
    return participants
      .map(p => this.getParticipantData(p))
      .filter(data => data !== null);
  }

  /**
   * Get segments for a single participant (convenience method).
   * @param {string} participantId 
   * @returns {ChartSegment[]}
   */
  getParticipantSegments(participantId) {
    const data = this.getParticipantData({ profileId: participantId, name: participantId });
    return data?.segments || [];
  }

  /**
   * Get segments for all known participants.
   * @param {Object[]} participants 
   * @returns {Map<string, ChartSegment[]>}
   */
  getAllSegments(participants) {
    const result = new Map();
    const allData = this.getAllParticipantsData(participants);
    allData.forEach(data => {
      result.set(data.id, data.segments);
    });
    return result;
  }

  /**
   * Create SVG paths from segments.
   * 
   * @param {ChartSegment[]} segments - Segments to convert
   * @param {Object} options - Rendering options
   * @param {number} [options.width=600]
   * @param {number} [options.height=240]
   * @param {number} [options.minVisibleTicks=30]
   * @param {Object} [options.margin]
   * @param {number} [options.effectiveTicks]
   * @param {number} [options.yScaleBase=1]
   * @param {number} [options.minValue=0]
   * @param {number} [options.maxValue]
   * @param {number} [options.topFraction=0.05]
   * @param {number} [options.bottomFraction=0.95]
   * @returns {ChartPath[]}
   */
  createPaths(segments, options = {}) {
    const {
      width = 600,
      height = 240,
      minVisibleTicks = MIN_VISIBLE_TICKS,
      margin = { top: 0, right: 0, bottom: 0, left: 0 },
      effectiveTicks: effectiveTicksOverride,
      yScaleBase = 1,
      minValue = 0,
      topFraction = 0.05,
      bottomFraction = 0.95
    } = options;

    if (!Array.isArray(segments) || segments.length === 0) return [];

    // Merge consecutive segments with same zone/gap status
    const mergedSegments = this._mergeSegments(segments);
    if (mergedSegments.length === 0) return [];

    // Calculate dimensions
    const innerWidth = Math.max(1, width - (margin.left || 0) - (margin.right || 0));
    const innerHeight = Math.max(1, height - (margin.top || 0) - (margin.bottom || 0));

    // Calculate max values
    let maxIndex = 0;
    let maxValue = minValue;
    mergedSegments.forEach(seg => {
      seg.points.forEach(pt => {
        if (pt.i > maxIndex) maxIndex = pt.i;
        if (Number.isFinite(pt.v) && pt.v > maxValue) maxValue = pt.v;
      });
    });

    if (options.maxValue != null && Number.isFinite(options.maxValue)) {
      maxValue = options.maxValue;
    }
    if (maxValue <= 0) maxValue = 1;

    const effectiveTicks = Math.max(minVisibleTicks, effectiveTicksOverride || maxIndex + 1, 1);
    
    // Create scale functions
    const scaleX = (i) => {
      if (effectiveTicks <= 1) return 0;
      const clampedIndex = Math.max(0, i);
      return Math.max(0, (margin.left || 0) + (clampedIndex / (effectiveTicks - 1)) * innerWidth);
    };

    const domainMin = Math.min(minValue, maxValue);
    const domainSpan = Math.max(1, maxValue - domainMin);
    const topFrac = Math.max(0, Math.min(1, topFraction));
    const bottomFrac = Math.max(topFrac, Math.min(1, bottomFraction));

    const scaleY = (v) => {
      const clamped = Math.max(domainMin, Math.min(maxValue, v));
      const norm = (clamped - domainMin) / domainSpan;
      let mapped = norm;
      if (yScaleBase > 1) {
        mapped = 1 - Math.log(1 + (1 - norm) * (yScaleBase - 1)) / Math.log(yScaleBase);
      }
      const frac = bottomFrac + (topFrac - bottomFrac) * mapped;
      return (margin.top || 0) + frac * innerHeight;
    };

    // Generate paths
    return mergedSegments.map(seg => {
      const points = seg.points.length === 1 ? [...seg.points, seg.points[0]] : seg.points;
      const path = points.reduce((acc, { i, v }, idx) => {
        const x = scaleX(i).toFixed(2);
        const y = scaleY(v).toFixed(2);
        return acc + `${idx === 0 ? 'M' : 'L'}${x},${y} `;
      }, '').trim();

      const segIsGap = Boolean(seg.isGap) || isDropout(seg.status);
      const defaultColor = ZONE_COLOR_MAP.default;

      return {
        zone: seg.zone,
        color: seg.color,
        status: seg.status || (segIsGap ? ParticipantStatus.IDLE : ParticipantStatus.ACTIVE),
        opacity: segIsGap ? 0.5 : (seg.color === defaultColor ? 0.1 : 1),
        isGap: segIsGap,
        d: path
      };
    });
  }

  /**
   * Create paths for a participant directly from their ID.
   * Convenience method that combines getParticipantData + createPaths.
   * 
   * @param {Object} participant 
   * @param {Object} pathOptions 
   * @returns {{ data: ParticipantChartData|null, paths: ChartPath[] }}
   */
  getParticipantPaths(participant, pathOptions = {}) {
    const data = this.getParticipantData(participant);
    if (!data) return { data: null, paths: [] };
    
    const paths = this.createPaths(data.segments, {
      ...pathOptions,
      maxValue: pathOptions.maxValue ?? data.maxVal
    });
    
    return { data, paths };
  }

  // ─────────────────────────────────────────────────────────────
  // Private methods - encapsulated transformation logic
  // ─────────────────────────────────────────────────────────────

  _normalizeId(entry) {
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    return entry.profileId || entry.name || entry.id || entry.displayLabel || null;
  }

  _toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  _padArray(arr, targetLength) {
    if (!Array.isArray(arr)) return new Array(targetLength).fill(null);
    const result = [...arr];
    while (result.length < targetLength) result.push(null);
    return result;
  }

  _normalizeNumericSeries(arr, targetLength) {
    if (!Array.isArray(arr)) return new Array(targetLength).fill(null);
    const result = arr.map((v) => {
      const n = this._toNumber(v);
      return n != null && n >= 0 ? Math.floor(n) : null;
    });
    return this._padArray(result, Math.max(targetLength, result.length));
  }

  _rebaseBeats(beats, firstActiveTick) {
    if (!Array.isArray(beats) || beats.length === 0) return [];
    if (!Number.isInteger(firstActiveTick) || firstActiveTick < 0) return beats;
    const baseline = beats[firstActiveTick] ?? 0;
    return beats.map((v, idx) => {
      if (idx < firstActiveTick) return null;
      if (v == null) return null;
      const rebased = v - baseline;
      return rebased >= 0 ? rebased : 0;
    });
  }

  _buildBeatsSeries(targetId) {
    const zones = this._getSeries(targetId, 'zone_id', { clone: true }) || [];
    const heartRate = this._getSeries(targetId, 'heart_rate', { clone: true }) || [];

    // Build activity mask purely from heart_rate (single source of truth)
    const maxLen = Math.max(zones.length, heartRate.length);
    const active = new Array(maxLen).fill(false);
    for (let i = 0; i < maxLen; i++) {
      const hr = this._toNumber(heartRate[i]);
      active[i] = hr != null && hr > 0;
    }

    const firstActiveTick = active.findIndex((v) => v === true);

    // Primary: coins_total
    const coinsRaw = this._getSeries(targetId, 'coins_total', { clone: true }) || null;
    if (Array.isArray(coinsRaw) && coinsRaw.length > 0) {
      const beats = this._rebaseBeats(
        this._normalizeNumericSeries(coinsRaw, maxLen),
        firstActiveTick
      );
      return { beats, zones: this._padArray(zones, maxLen), active, firstActiveTick };
    }

    // Secondary: heart_beats
    const beatsRaw = this._getSeries(targetId, 'heart_beats', { clone: true }) || null;
    if (Array.isArray(beatsRaw) && beatsRaw.length > 0) {
      const beats = this._rebaseBeats(
        this._normalizeNumericSeries(beatsRaw, maxLen),
        firstActiveTick
      );
      return { beats, zones: this._padArray(zones, maxLen), active, firstActiveTick };
    }

    // Fallback: compute from heart_rate
    if (!Array.isArray(heartRate) || heartRate.length === 0) {
      return { beats: [], zones: [], active: [], firstActiveTick: -1 };
    }

    const beats = new Array(maxLen).fill(null);
    let total = 0;
    const intervalSeconds = this._intervalMs / 1000;
    for (let idx = 0; idx < maxLen; idx++) {
      const hrVal = this._toNumber(heartRate[idx]);
      if (hrVal != null && hrVal > 0) {
        total += (hrVal / 60) * intervalSeconds;
      }
      beats[idx] = Math.floor(total);
    }

    return {
      beats: this._rebaseBeats(beats, firstActiveTick),
      zones: this._padArray(zones, maxLen),
      active,
      firstActiveTick
    };
  }

  _buildSegments(beats, zones, active) {
    const segments = [];
    let current = null;
    let lastZone = null;
    let lastPoint = null;
    let gapStartPoint = null;
    let inGap = false;

    const pushCurrent = () => {
      if (current && current.points.length > 0) {
        segments.push(current);
      }
      current = null;
    };

    for (let i = 0; i < beats.length; i++) {
      const value = this._toNumber(beats[i]);
      const zoneRaw = zones?.[i] ?? null;
      const isActiveAtTick = active[i] === true;

      const tickStatus = value == null
        ? ParticipantStatus.ABSENT
        : (isActiveAtTick ? ParticipantStatus.ACTIVE : ParticipantStatus.IDLE);

      if (tickStatus === ParticipantStatus.ABSENT) {
        if (lastPoint && !gapStartPoint) {
          gapStartPoint = { ...lastPoint };
          inGap = true;
        }
        pushCurrent();
        continue;
      }

      if (isDropout(tickStatus)) {
        if (!gapStartPoint && lastPoint) {
          gapStartPoint = { ...lastPoint };
        }
        inGap = true;
        continue;
      }

      // ACTIVE status
      if (inGap && gapStartPoint) {
        const gapSegment = {
          zone: null,
          color: ZONE_COLOR_MAP.default,
          status: ParticipantStatus.IDLE,
          isGap: true,
          points: [
            { ...gapStartPoint },
            { i, v: value }
          ]
        };
        segments.push(gapSegment);
        gapStartPoint = null;
        inGap = false;
        lastPoint = null;
      }

      const zone = zoneRaw || lastZone || null;
      const color = ZONE_COLOR_MAP[zone] || ZONE_COLOR_MAP.default;

      if (!current || current.zone !== zone) {
        pushCurrent();
        current = {
          zone,
          color,
          status: ParticipantStatus.ACTIVE,
          isGap: false,
          points: []
        };
        if (lastPoint) {
          current.points.push({ ...lastPoint });
        }
      }

      lastZone = zone;
      current.points.push({ i, v: value });
      lastPoint = { i, v: value };
    }

    pushCurrent();
    return segments;
  }

  _mergeSegments(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return [];

    const merged = [];
    let prev = null;

    segments.forEach(seg => {
      if (!seg || !seg.points || seg.points.length === 0) return;

      const canMerge = prev &&
        prev.zone === seg.zone &&
        prev.isGap === seg.isGap &&
        !prev.isGap;

      if (canMerge) {
        // Skip first point if it duplicates prev's last
        const startIdx = (
          seg.points.length > 0 &&
          prev.points.length > 0 &&
          seg.points[0].i === prev.points[prev.points.length - 1].i
        ) ? 1 : 0;
        prev.points.push(...seg.points.slice(startIdx));
      } else {
        const copy = {
          zone: seg.zone,
          color: seg.color,
          status: seg.status,
          isGap: Boolean(seg.isGap),
          points: [...seg.points]
        };
        merged.push(copy);
        prev = copy;
      }
    });

    return merged;
  }
}

/**
 * Create a ChartDataBuilder instance
 * @param {Object} options 
 * @returns {ChartDataBuilder}
 */
export const createChartDataBuilder = (options) => new ChartDataBuilder(options);

export default ChartDataBuilder;
