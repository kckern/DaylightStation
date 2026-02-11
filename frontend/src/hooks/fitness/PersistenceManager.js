/**
 * PersistenceManager - Handles fitness session persistence and validation.
 *
 * Single Responsibility: Own session data validation, encoding, and API persistence.
 *
 * Extracted from FitnessSession as part of the Single Responsibility refactoring
 * (postmortem-entityid-migration-fitnessapp.md #13).
 *
 * Responsibilities:
 * - Validate session payloads before persistence
 * - Encode timeline series (RLE compression)
 * - Transform session data to v2 or v3 format
 * - Call persistence API
 *
 * v3 format support: Use buildPayload() for v3 serialization via SessionSerializerV3.
 *
 * @see /docs/design/fitness-data-flow.md
 */

import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';
import { SessionSerializerV3 } from './SessionSerializerV3.js';

// -------------------- Constants --------------------

const MAX_SERIALIZED_SERIES_POINTS = 200000;

const ZONE_SYMBOL_MAP = {
  cool: 'c',
  active: 'a',
  warm: 'w',
  hot: 'h'
};

// -------------------- Helper Functions --------------------

/**
 * Round values for persistence.
 * @param {string} key
 * @param {unknown} value
 * @returns {number|null|unknown}
 */
const roundValue = (key, value) => {
  if (value == null) return null;
  if (typeof value !== 'number') return value;
  if (!Number.isFinite(value)) return null;

  const k = String(key || '').toLowerCase();

  // Cumulative series - round to 1 decimal
  if (k.includes('beats') || k.includes('rotations')) {
    return Math.round(value * 10) / 10;
  }

  // Integer metrics
  return Math.round(value);
};

/**
 * Format a unix-ms timestamp into a human-readable string.
 * @param {number} unixMs
 * @param {string} timezone
 * @returns {string|null}
 */
const toReadable = (unixMs, timezone) => {
  if (!Number.isFinite(unixMs)) return null;
  // Dynamic import would be cleaner but we'll use Date for simplicity
  const date = new Date(unixMs);
  return date.toISOString().replace('T', ' ').replace('Z', '');
};

/**
 * Resolve the timezone used for persistence.
 * @returns {string}
 */
const resolvePersistTimezone = () => {
  const intl = Intl?.DateTimeFormat?.()?.resolvedOptions?.()?.timeZone;
  return intl || 'UTC';
};

/**
 * Derive the numeric session id used in v2 payloads.
 * @param {string|null} sessionId
 * @returns {string|null}
 */
const deriveNumericSessionId = (sessionId) => {
  if (!sessionId) return null;
  const raw = String(sessionId).trim();
  if (!raw) return null;
  return raw.startsWith('fs_') ? raw.slice(3) : raw;
};

/**
 * Derive YYYY-MM-DD from a numeric session id (YYYYMMDDHHmmss).
 * @param {string|null} numericSessionId
 * @returns {string|null}
 */
const deriveSessionDate = (numericSessionId) => {
  if (!numericSessionId || numericSessionId.length < 8) return null;
  const y = numericSessionId.slice(0, 4);
  const m = numericSessionId.slice(4, 6);
  const d = numericSessionId.slice(6, 8);
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
};

/**
 * Sanitize roster entries for persistence.
 * @param {Array} roster
 * @returns {Array}
 */
const sanitizeRosterForPersist = (roster) => {
  if (!Array.isArray(roster)) return [];
  return roster
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const name = typeof entry.name === 'string' ? entry.name : null;
      const profileId = entry.profileId || entry.id || null;
      const hrDeviceId = entry.hrDeviceId ?? null;
      const isPrimary = entry.isPrimary === true;
      const isGuest = entry.isGuest === true;
      const baseUserName = entry.baseUserName || null;
      if (!name && !profileId && !hrDeviceId) return null;
      return {
        ...(name ? { name } : {}),
        ...(profileId ? { profileId } : {}),
        ...(hrDeviceId ? { hrDeviceId } : {}),
        ...(isPrimary ? { isPrimary } : {}),
        ...(isGuest ? { isGuest } : {}),
        ...(baseUserName ? { baseUserName } : {})
      };
    })
    .filter(Boolean);
};

/**
 * Convert roster + assignment snapshots into a keyed participant object.
 *
 * Logic for is_guest/is_primary:
 * - If entry.isGuest is explicitly true → is_guest: true
 * - If entry.isPrimary is explicitly true → is_primary: true, is_guest omitted
 * - If neither is set, default to is_primary: true (assume registered user, not guest)
 *
 * @param {Array} roster
 * @param {Array} deviceAssignments
 * @returns {Record<string, Object>}
 */
const buildParticipantsForPersist = (roster, deviceAssignments) => {
  const participants = {};

  const assignmentBySlug = new Map();
  if (Array.isArray(deviceAssignments)) {
    deviceAssignments.forEach((entry) => {
      const key = entry?.occupantId || entry?.occupantSlug;
      if (!key) return;
      assignmentBySlug.set(String(key), entry);
    });
  }

  const safeRoster = Array.isArray(roster) ? roster : [];
  safeRoster.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') return;
    const name = typeof entry.name === 'string' ? entry.name : null;
    const participantId = entry.id || entry.profileId || entry.hrDeviceId || `anon-${idx}`;
    if (!participantId) return;

    const assignment = assignmentBySlug.get(participantId) || null;
    const hrDevice = entry.hrDeviceId ?? assignment?.deviceId ?? null;

    // Determine guest vs primary status
    const isExplicitlyGuest = entry.isGuest === true;
    const isExplicitlyPrimary = entry.isPrimary === true;

    // Default to primary user if neither is set (registered users aren't guests)
    const isPrimary = isExplicitlyPrimary || (!isExplicitlyGuest && !isExplicitlyPrimary);
    const isGuest = isExplicitlyGuest && !isExplicitlyPrimary;

    participants[participantId] = {
      ...(name ? { display_name: name } : {}),
      ...(hrDevice != null ? { hr_device: String(hrDevice) } : {}),
      ...(isPrimary ? { is_primary: true } : {}),
      ...(isGuest ? { is_guest: true } : {}),
      ...(entry.baseUserName ? { base_user: String(entry.baseUserName) } : {})
    };
  });

  return participants;
};

/**
 * Map series keys to v2 compact format for persistence.
 *
 * Transformations:
 * - user:alan:heart_rate -> alan:hr
 * - user:alan:zone_id -> alan:zone
 * - user:alan:heart_beats -> alan:beats
 * - user:alan:coins_total -> alan:coins
 * - device:7138:rpm -> bike:7138:rpm (equipment metrics)
 * - device:device_7138:rpm -> bike:7138:rpm (fix double-prefix)
 * - global:coins-total -> global:coins
 *
 * @param {Object} series
 * @returns {Object}
 */
const mapSeriesKeysForPersist = (series) => {
  if (!series || typeof series !== 'object') return {};

  const METRIC_MAP = {
    'heart_rate': 'hr',
    'heart-rate': 'hr',
    'zone_id': 'zone',
    'zone-id': 'zone',
    'heart_beats': 'beats',
    'heart-beats': 'beats',
    'coins_total': 'coins',
    'coins-total': 'coins'
  };

  const EQUIPMENT_METRICS = new Set(['rpm', 'rotations', 'power', 'distance']);

  const mapped = {};
  Object.entries(series).forEach(([key, value]) => {
    if (!key || typeof key !== 'string') {
      mapped[key] = value;
      return;
    }

    const parts = key.split(':');
    let mappedKey = key;

    if (parts[0] === 'user' && parts.length >= 3) {
      // user:slug:metric -> slug:compactMetric
      const slug = parts[1];
      const metric = parts.slice(2).join(':');
      const compactMetric = METRIC_MAP[metric] || metric.replace(/_/g, '-');
      mappedKey = `${slug}:${compactMetric}`;
    } else if (parts[0] === 'device' && parts.length >= 3) {
      // device:id:metric -> bike:id:metric (for equipment) or device:id:metric (for wearables)
      let id = parts[1];
      // Fix double-prefix: device_7138 -> 7138
      if (id && id.startsWith('device_')) {
        id = id.slice('device_'.length);
      }
      const metric = parts.slice(2).join(':');
      const compactMetric = metric.replace(/_/g, '-');

      if (EQUIPMENT_METRICS.has(metric) || EQUIPMENT_METRICS.has(compactMetric)) {
        mappedKey = `bike:${id}:${compactMetric}`;
      } else {
        mappedKey = `device:${id}:${compactMetric}`;
      }
    } else if (parts[0] === 'global' && parts.length >= 2) {
      // global:coins-total -> global:coins
      const metric = parts.slice(1).join(':');
      const compactMetric = METRIC_MAP[metric] || metric.replace(/_/g, '-');
      mappedKey = `global:${compactMetric}`;
    } else {
      // Fallback: just convert underscores to hyphens
      mappedKey = key.replace(/_/g, '-');
    }

    mapped[mappedKey] = value;
  });
  return mapped;
};

// -------------------- PersistenceManager Class --------------------

/**
 * @typedef {Object} PersistenceManagerConfig
 * @property {Function} [persistApi] - Custom API function (defaults to DaylightAPI)
 * @property {Function} [onLog] - Logging callback
 * @property {Function} [validateSeriesLengths] - Series length validator
 */

export class PersistenceManager {
  /**
   * @param {PersistenceManagerConfig} [config]
   */
  constructor(config = {}) {
    this._persistApi = config.persistApi || DaylightAPI;
    this._onLog = config.onLog || null;
    this._validateSeriesLengths = config.validateSeriesLengths || null;
    
    // Track save state
    this._saveTriggered = false;
    this._lastSaveAt = 0;
  }

  /**
   * Set logging callback.
   * @param {Function} callback
   */
  setLogCallback(callback) {
    this._onLog = callback;
  }

  /**
   * Set series length validator.
   * @param {Function} validator
   */
  setSeriesLengthValidator(validator) {
    this._validateSeriesLengths = validator;
  }

  /**
   * Check if a save is currently in progress.
   * @returns {boolean}
   */
  isSaveInProgress() {
    return this._saveTriggered;
  }

  /**
   * Get timestamp of last save.
   * @returns {number}
   */
  getLastSaveTime() {
    return this._lastSaveAt;
  }

  // -------------------- Payload Building (v3) --------------------

  /**
   * Build a v3 session payload using SessionSerializerV3.
   * @param {Object} sessionData - Raw session data
   * @returns {Object} v3 formatted session payload
   */
  buildPayload(sessionData) {
    return SessionSerializerV3.serialize(sessionData);
  }

  // -------------------- Encoding --------------------

  /**
   * Encode a single value for persistence.
   * @param {string} key
   * @param {unknown} value
   * @returns {unknown}
   */
  _encodeValue(key, value) {
    if (value == null) return null;
    if (typeof value === 'number') {
      return roundValue(key, value);
    }
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
    if (key.includes('zone')) {
      if (typeof normalized === 'string') {
        return ZONE_SYMBOL_MAP[normalized] || normalized;
      }
      return normalized;
    }
    return normalized;
  }

  /**
   * Run-length encode an array.
   * @param {string} key
   * @param {Array} arr
   * @returns {Array}
   */
  _runLengthEncode(key, arr) {
    const encoded = [];
    for (let i = 0; i < arr.length; i += 1) {
      const value = this._encodeValue(key, arr[i]);
      const last = encoded[encoded.length - 1];

      // Compact RLE:
      // - bare value for count=1
      // - [value, count] for repeats
      if (Array.isArray(last) && last[0] === value) {
        last[1] += 1;
      } else if (last === value) {
        encoded[encoded.length - 1] = [value, 2];
      } else {
        encoded.push(value);
      }
    }
    return encoded;
  }

  /**
   * Encode all series for persistence.
   * @param {Object} series
   * @param {number} [tickCount]
   * @returns {{ encodedSeries: Object }}
   */
  encodeSeries(series = {}, tickCount = null) {
    const encodedSeries = {};
    Object.entries(series).forEach(([key, arr]) => {
      if (!Array.isArray(arr)) {
        encodedSeries[key] = arr;
        return;
      }

      // Empty-series filtering: do not persist all-null/empty series
      if (!arr.length || arr.every((v) => v == null)) {
        return;
      }

      // All-zero series filtering: do not persist series where every value is 0
      // (e.g., device:40475:rotations = [[0, 163]] when no rotations recorded)
      if (arr.every((v) => v === 0)) {
        return;
      }

      const rle = this._runLengthEncode(key, arr);
      encodedSeries[key] = JSON.stringify(rle);
    });
    return { encodedSeries };
  }

  // -------------------- Validation --------------------

  /**
   * Validate session payload before persistence.
   * @param {Object} sessionData
   * @returns {{ ok: boolean, reason?: string, endTime?: number, durationMs?: number }}
   */
  validateSessionPayload(sessionData) {
    if (!sessionData) return { ok: false, reason: 'missing-session' };
    
    const { startTime } = sessionData;
    if (!Number.isFinite(startTime)) return { ok: false, reason: 'invalid-startTime' };

    let endTime = Number(sessionData.endTime);
    if (!Number.isFinite(endTime)) {
      endTime = Date.now();
    }
    if (endTime <= startTime) {
      endTime = startTime + 1;
    }
    sessionData.endTime = endTime;
    sessionData.durationMs = Math.max(0, endTime - startTime);

    const roster = Array.isArray(sessionData.roster) ? sessionData.roster : [];
    const series = sessionData.timeline?.series || {};
    const tickCount = Number(sessionData.timeline?.timebase?.tickCount) || 0;
    const hasUserSeries = Object.keys(series).some((key) => typeof key === 'string' && key.startsWith('user:'));
    const deviceAssignments = Array.isArray(sessionData.deviceAssignments) ? sessionData.deviceAssignments : [];

    if (hasUserSeries && roster.length === 0) {
      return { ok: false, reason: 'roster-required' };
    }
    if (hasUserSeries && deviceAssignments.length === 0) {
      return { ok: false, reason: 'device-assignments-required' };
    }

    // Hard minimums: must have participants and be over 60 seconds
    if (roster.length === 0) {
      return { ok: false, reason: 'no-participants' };
    }
    if (sessionData.durationMs < 60000) {
      return { ok: false, reason: 'session-too-short', durationMs: sessionData.durationMs };
    }

    // Deduplicate challenge events
    if (Array.isArray(sessionData.timeline?.events)) {
      const seen = new Set();
      sessionData.timeline.events = sessionData.timeline.events.filter((evt) => {
        if (!evt || typeof evt !== 'object') return false;
        const type = evt.type || evt.eventType || null;
        if (!type) return false;
        const tickIndex = Number.isFinite(evt.tickIndex) ? evt.tickIndex : null;
        const challengeId = evt.data?.challengeId || evt.data?.challenge_id || evt.data?.challenge || null;
        const key = `${type}|${tickIndex}|${challengeId || ''}`;
        if (type.startsWith('challenge_')) {
          if (seen.has(key)) return false;
          seen.add(key);
        }
        return true;
      });
    }

    // Require minimum ticks
    if (tickCount < 3) {
      return { ok: false, reason: 'insufficient-ticks', tickCount };
    }

    // Validate series lengths
    if (this._validateSeriesLengths) {
      const { ok: lengthsOk, issues } = this._validateSeriesLengths(sessionData.timeline?.timebase || {}, series);
      if (!lengthsOk) {
        return { ok: false, reason: 'series-tick-mismatch', issues };
      }
    }

    // Check total points
    let totalPoints = 0;
    Object.values(series).forEach((entry) => {
      if (Array.isArray(entry)) {
        totalPoints += entry.length;
      }
    });
    if (totalPoints > MAX_SERIALIZED_SERIES_POINTS) {
      return { ok: false, reason: 'series-size-cap', totalPoints };
    }

    return { ok: true, endTime, durationMs: sessionData.durationMs };
  }

  // -------------------- Persistence --------------------

  /**
   * Persist session data to the API.
   * @param {Object} sessionData
   * @param {Object} [options]
   * @param {boolean} [options.force=false]
   * @returns {boolean} - Whether persistence was initiated
   */
  persistSession(sessionData, { force = false } = {}) {
    if (!sessionData) {
      getLogger().warn('fitness.persistence.no_data');
      return false;
    }
    if (this._saveTriggered && !force) {
      // DEBUG: Log when save is blocked (throttled)
      if ((this._debugBlockedCount = (this._debugBlockedCount || 0) + 1) <= 3) {
        console.error(`🚫 SAVE_BLOCKED [${this._debugBlockedCount}/3]: ${sessionData?.sessionId} - previous save still in progress`);
      }
      getLogger().warn('fitness.persistence.save_in_progress');
      return false;
    }

    const validation = this.validateSessionPayload(sessionData);
    getLogger().debug('fitness.persistence.validation', { validation });
    if (!validation?.ok) {
      // DEBUG: Always log validation failures
      console.error(`⚠️ VALIDATION_FAIL: ${sessionData?.sessionId}, reason="${validation?.reason}"`, validation);
      this._log('persist_validation_fail', { reason: validation.reason, detail: validation });
      return false;
    }

    // Build persistence payload
    const timezone = resolvePersistTimezone();
    const numericSessionId = deriveNumericSessionId(sessionData.sessionId);
    const sessionDate = deriveSessionDate(numericSessionId);
    const startReadable = toReadable(sessionData.startTime, timezone);
    const endReadable = toReadable(sessionData.endTime, timezone);
    const durationSeconds = Number.isFinite(sessionData.durationMs)
      ? Math.round(sessionData.durationMs / 1000)
      : null;

    const sanitizedRoster = sanitizeRosterForPersist(sessionData.roster);
    const participants = buildParticipantsForPersist(sanitizedRoster, sessionData.deviceAssignments);

    const persistSessionData = {
      ...sessionData,
      version: 3,
      timezone,
      startTime: startReadable,
      endTime: endReadable,
      session: {
        ...(numericSessionId ? { id: String(numericSessionId) } : {}),
        ...(sessionDate ? { date: sessionDate } : {}),
        ...(startReadable ? { start: startReadable } : {}),
        ...(endReadable ? { end: endReadable } : {}),
        ...(durationSeconds != null ? { duration_seconds: durationSeconds } : {})
      },
      participants
    };

    if (persistSessionData.timeline && typeof persistSessionData.timeline === 'object') {
      persistSessionData.timeline = { ...persistSessionData.timeline };
    }

    // Convert event timestamps and build v2 events array
    const v2Events = this._buildV2Events(sessionData, timezone);

    // Move voice memos into events (skip if already in events from timeline)
    const existingMemoIds = this._lastVoiceMemoIds || new Set();
    const voiceMemos = Array.isArray(sessionData.voiceMemos) ? sessionData.voiceMemos : [];
    voiceMemos.forEach((memo) => {
      if (!memo || typeof memo !== 'object') return;

      // Skip if this memo was already added from timeline events
      const memoId = memo.memoId ?? memo.id;
      if (memoId && existingMemoIds.has(memoId)) {
        return;
      }

      const rawTs = Number(memo.createdAt ?? memo.startedAt ?? memo.endedAt);
      const at = Number.isFinite(rawTs) ? toReadable(rawTs, timezone) : null;
      v2Events.push({
        ...(at ? { at } : {}),
        type: 'voice_memo',
        data: {
          id: memoId ?? null,
          duration_seconds: Number.isFinite(memo.durationSeconds) ? memo.durationSeconds : null,
          transcript: memo.transcriptClean ?? memo.transcript ?? null
        }
      });
    });

    if (v2Events.length) {
      persistSessionData.events = v2Events;
    }

    // Restructure timeline with v2 fields
    if (persistSessionData.timeline && typeof persistSessionData.timeline === 'object') {
      const intervalMs = Number(persistSessionData.timeline?.timebase?.intervalMs);
      const tickCount = Number(persistSessionData.timeline?.timebase?.tickCount);
      persistSessionData.timeline.interval_seconds = Number.isFinite(intervalMs) ? Math.round(intervalMs / 1000) : null;
      persistSessionData.timeline.tick_count = Number.isFinite(tickCount) ? tickCount : null;
      persistSessionData.timeline.encoding = 'rle';

      // Keep timeline.events for backend persistence (backend uses timeline.events as canonical source)
    }

    // Add entities array (session participation segments)
    if (Array.isArray(sessionData.entities) && sessionData.entities.length > 0) {
      persistSessionData.entities = sessionData.entities.map((entity) => {
        if (!entity || typeof entity !== 'object') return null;
        return {
          entityId: entity.entityId || null,
          profileId: entity.profileId || null,
          deviceId: entity.deviceId || null,
          startTime: entity.startTime || null,
          endTime: entity.endTime || null,
          status: entity.status || 'active',
          coins: entity.coins || 0
        };
      }).filter(Boolean);
    }

    // Remove legacy duplicates — session block + participants are canonical v3 sources
    delete persistSessionData.roster;
    delete persistSessionData.voiceMemos;
    delete persistSessionData.deviceAssignments;
    delete persistSessionData.timebase;
    delete persistSessionData.durationMs;
    // startTime/endTime kept at root as readable strings (backend parses them as fallback)
    // sessionId kept for backward compat with backend normalizePayload detection

    // Drop redundant timeline.timebase (flattened fields are canonical)
    if (persistSessionData.timeline) {
      delete persistSessionData.timeline.timebase;
    }

    // Encode series
    if (persistSessionData.timeline?.series) {
      const tickCount = Number(persistSessionData.timeline?.timebase?.tickCount);
      const rawSeries = persistSessionData.timeline.series;
      const rawKeys = rawSeries && typeof rawSeries === 'object' ? Object.keys(rawSeries) : [];
      
      this._log('persist_series_encode_before', {
        sessionId: persistSessionData.session?.id,
        seriesCount: rawKeys.length,
        tickCount,
        sampleKeys: rawKeys.slice(0, 5)
      });

      const { encodedSeries } = this.encodeSeries(persistSessionData.timeline.series, tickCount);
      const mappedSeries = mapSeriesKeysForPersist(encodedSeries);
      const encodedKeys = Object.keys(mappedSeries || {});
      const droppedKeys = rawKeys.filter((key) => !Object.prototype.hasOwnProperty.call(encodedSeries || {}, key));
      
      this._log('persist_series_encode_after', {
        sessionId: persistSessionData.session?.id,
        encodedCount: encodedKeys.length,
        droppedKeys: droppedKeys.slice(0, 5),
        wasEmpty: encodedKeys.length === 0,
        tickCount
      });

      persistSessionData.timeline.series = mappedSeries;
    }

    // Log pre-API state
    const seriesSample = persistSessionData.timeline?.series
      ? Object.entries(persistSessionData.timeline.series).slice(0, 2)
      : [];
    getLogger().debug('fitness.persistence.pre_api', {
      sessionId: persistSessionData.session?.id,
      hasTimeline: !!persistSessionData.timeline,
      seriesKeys: persistSessionData.timeline?.series ? Object.keys(persistSessionData.timeline.series).length : 0,
      seriesSample: seriesSample.map(([k, v]) => [k, typeof v, v?.substring?.(0, 50)])
    });

    // Persist
    this._lastSaveAt = Date.now();
    this._saveTriggered = true;

    // DEBUG: Log save attempt (throttled: first 5 only)
    if ((this._debugSaveCount = (this._debugSaveCount || 0) + 1) <= 5) {
      const tickCount = persistSessionData.timeline?.timebase?.tickCount || 0;
      const seriesCount = Object.keys(persistSessionData.timeline?.series || {}).length;
      console.error(`📤 SESSION_SAVE [${this._debugSaveCount}/5]: ${persistSessionData.session?.id}, ticks=${tickCount}, series=${seriesCount}`);
    }

    this._persistApi('api/v1/fitness/save_session', { sessionData: persistSessionData }, 'POST')
      .then(resp => {
        // DEBUG: Log success (throttled)
        if ((this._debugSaveSuccessCount = (this._debugSaveSuccessCount || 0) + 1) <= 3) {
          console.error(`✅ SESSION_SAVED [${this._debugSaveSuccessCount}/3]: ${persistSessionData.session?.id}`);
        }
      })
      .catch(err => {
        // DEBUG: Always log failures (these are critical)
        console.error(`❌ SESSION_SAVE_FAILED: ${persistSessionData.session?.id}`, err?.message || err);
        getLogger().error('fitness.persistence.failed', { error: err.message });
      })
      .finally(() => {
        this._saveTriggered = false;
      });

    return true;
  }

  // -------------------- Private Helpers --------------------

  _log(eventName, data) {
    if (this._onLog) {
      this._onLog(eventName, data);
    }
  }

  _buildV2Events(sessionData, timezone) {
    const v2Events = [];

    // Track voice memo IDs to avoid duplicates (voice_memo_start + voice_memo for same memo)
    const voiceMemoIds = new Set();

    if (sessionData.timeline && Array.isArray(sessionData.timeline.events)) {
      sessionData.timeline.events.forEach((evt) => {
        if (!evt || typeof evt !== 'object') return;

        // Skip voice_memo_start events - voice_memo is the final consolidated version
        if (evt.type === 'voice_memo_start') {
          return;
        }

        // Track voice_memo IDs to dedupe with voiceMemos array
        if (evt.type === 'voice_memo' && evt.data?.memoId) {
          voiceMemoIds.add(evt.data.memoId);
        }

        const rawTs = Number(evt.timestamp);
        const readableTs = Number.isFinite(rawTs) ? toReadable(rawTs, timezone) : null;
        if (readableTs) {
          v2Events.push({
            at: readableTs,
            type: evt.type,
            data: evt.data ?? null
          });
        }
      });
    }

    // Store voiceMemoIds on this for use by persistSession
    this._lastVoiceMemoIds = voiceMemoIds;
    return v2Events;
  }
}

/**
 * Create a PersistenceManager instance.
 * @param {PersistenceManagerConfig} [config]
 * @returns {PersistenceManager}
 */
export const createPersistenceManager = (config) => new PersistenceManager(config);

export default PersistenceManager;
