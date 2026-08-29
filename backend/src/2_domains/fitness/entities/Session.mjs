/**
 * Session Entity - Represents a fitness session
 *
 * SessionId format: YYYYMMDDHHmmss (14 digits derived from start time)
 * Timeline contains:
 *   - series: { [participantName]: number[] } - heart rate values per second
 *   - events: { timestamp, type, data }[] - discrete events during session
 */

import { ValidationError } from '#domains/core/errors/index.mjs';
import { SessionId } from '../value-objects/SessionId.mjs';
import { appendStrengthRun } from '../workout/strengthLog.mjs';

export class Session {
  constructor({
    sessionId,
    startTime,
    endTime = null,
    durationMs = null,
    timezone = null,
    roster = [],
    timeline = { series: {}, events: [] },
    snapshots = { captures: [], updatedAt: null },
    metadata = {},
    // v3 fields
    version = 3,
    events = [],
    participants = {},
    entities = [],
    treasureBox = null,
    session = null,
    summary = null,   // Session summary (computed by frontend, preserved through persistence)
    strava = null,     // Strava activity metadata (name, type, sportType, etc.)
    strava_notes = null, // Manually-entered Strava notes pulled back via reconciliation
    finalized = false,
    provisional = false, // Real but sub-5-min, not-yet-finalized session (resumable; hidden from history; GC'd if never matured). See PersistenceManager Stage 3.
    timelapse = null, // Session time-lapse recap status/record
    strength = null // Strength runs performed in this session: { runs: [...] }. Absent on a session with no strength work.
  }) {
    // Normalize sessionId to SessionId value object
    this.sessionId = sessionId instanceof SessionId ? sessionId : new SessionId(sessionId);
    this.startTime = startTime;
    this.endTime = endTime;
    this.durationMs = durationMs;
    this.timezone = timezone;
    this.roster = roster;
    this.timeline = timeline;
    this.snapshots = snapshots;
    this.metadata = metadata;
    // v3 fields - preserved through persistence round-trip
    this.version = version;
    this.events = Array.isArray(events) ? events : [];
    this.participants = participants && typeof participants === 'object' ? participants : {};
    this.entities = Array.isArray(entities) ? entities : [];
    this.treasureBox = treasureBox;
    this.session = session;
    this.summary = summary;
    this.strava = strava;
    this.strava_notes = strava_notes;
    this.finalized = !!finalized;
    this.provisional = !!provisional;
    this.timelapse = timelapse;
    this.strength = strength;
  }

  /**
   * Record a finished strength run on this session.
   *
   * A garage session is one visit, and a visit can contain a ride, a bailed workout and a
   * restart of it. The aggregate root owns the accumulation so no caller can overwrite
   * sets somebody actually performed — see `appendStrengthRun` for the append/replace rule.
   *
   * @param {Object} run A run block from `makeStrengthRun` (2_domains/fitness/workout).
   */
  addStrengthRun(run) {
    if (!run || typeof run !== 'object') return;
    this.strength = appendStrengthRun(this.strength, run);
  }

  /** Strength runs recorded on this session, oldest first. */
  getStrengthRuns() {
    return Array.isArray(this.strength?.runs) ? this.strength.runs : [];
  }

  /**
   * Time-lapse recap lifecycle — the aggregate root owns its status transitions.
   * status: processing | ready | skipped | failed
   */
  markTimelapseProcessing(now) {
    Session.#requireNow(now);
    this.timelapse = { status: 'processing', startedAt: now };
  }

  attachTimelapse({ videoPath, durationSeconds = null, fps = null, frameCount = null, now }) {
    if (videoPath == null) {
      throw new ValidationError('videoPath required', { code: 'MISSING_VIDEO_PATH', field: 'videoPath' });
    }
    Session.#requireNow(now);
    this.timelapse = { status: 'ready', videoPath, durationSeconds, fps, frameCount, createdAt: now };
  }

  markTimelapseSkipped(reason = 'no-captures', now) {
    Session.#requireNow(now);
    this.timelapse = { status: 'skipped', reason, createdAt: now };
  }

  markTimelapseFailed(error, now) {
    Session.#requireNow(now);
    this.timelapse = { status: 'failed', error: error?.message || String(error), failedAt: now };
  }

  static #requireNow(now) {
    if (typeof now !== 'number' || !Number.isFinite(now)) {
      throw new ValidationError('now (epoch ms) is required', { code: 'MISSING_CLOCK', field: 'now' });
    }
  }

  /**
   * Get session duration in milliseconds
   * Uses stored durationMs if available, otherwise calculates from times
   */
  getDurationMs() {
    if (this.durationMs != null) return this.durationMs;
    if (!this.endTime || !this.startTime) return null;
    const start = typeof this.startTime === 'number' ? this.startTime : new Date(this.startTime).getTime();
    const end = typeof this.endTime === 'number' ? this.endTime : new Date(this.endTime).getTime();
    return Math.max(0, end - start);
  }

  /**
   * Get duration in minutes
   */
  getDurationMinutes() {
    const duration = this.getDurationMs();
    return duration != null ? Math.round(duration / 60000) : null;
  }

  /**
   * Check if session is active (not ended)
   */
  isActive() {
    return this.endTime === null;
  }

  /**
   * Check if session is completed
   */
  isCompleted() {
    return this.endTime !== null;
  }

  /**
   * Get participant by name
   */
  getParticipant(name) {
    return this.roster.find(p => p.name === name) ?? null;
  }

  /**
   * Get primary participant
   */
  getPrimaryParticipant() {
    return this.roster.find(p => p.isPrimary) ?? this.roster[0] ?? null;
  }

  /**
   * Get roster count
   */
  getRosterCount() {
    return this.roster.length;
  }

  /**
   * Add a participant to roster
   */
  addParticipant(participant) {
    if (!this.getParticipant(participant.name)) {
      this.roster.push(participant);
    }
  }

  /**
   * Remove a participant from roster
   */
  removeParticipant(name) {
    this.roster = this.roster.filter(p => p.name !== name);
  }

  /**
   * End the session.
   *
   * Sets endTime, computes durationMs, and marks the session `finalized`
   * so it won't be offered for resume or auto-merged into a later
   * workout. A "finalized" session is a clean split — subsequent HR
   * readings belong to a new session.
   *
   * @param {number} endTime - End timestamp in milliseconds (required)
   */
  end(endTime) {
    if (endTime == null) {
      throw new ValidationError('endTime required', { code: 'MISSING_END_TIME', field: 'endTime' });
    }
    this.endTime = endTime;
    this.durationMs = this.getDurationMs();
    this.finalized = true;
  }

  /**
   * Replace timeline (for encoding/decoding transforms)
   */
  replaceTimeline(timeline) {
    this.timeline = timeline;
  }

  /**
   * Replace snapshots (for merging from existing session data)
   */
  replaceSnapshots(snapshots) {
    this.snapshots = snapshots;
  }

  /**
   * Remove snapshot by filename (dedup before adding new)
   */
  removeDuplicateSnapshot(filename) {
    if (this.snapshots?.captures) {
      this.snapshots.captures = this.snapshots.captures.filter(
        entry => entry?.filename !== filename
      );
    }
  }

  /**
   * Add heart rate value to a participant's series
   */
  addHeartRate(participantName, value) {
    if (!this.timeline.series[participantName]) {
      this.timeline.series[participantName] = [];
    }
    this.timeline.series[participantName].push(value);
  }

  /**
   * Add a timeline event
   * @param {string} type - Event type
   * @param {Object} data - Event data
   * @param {number} timestamp - Event timestamp in milliseconds (required)
   */
  addEvent(type, data = {}, timestamp) {
    if (timestamp == null) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    this.timeline.events.push({
      timestamp,
      type,
      ...data
    });
  }

  /**
   * Add a snapshot/screenshot
   * @param {Object} capture - Capture info
   * @param {number} timestamp - Timestamp in milliseconds (required)
   */
  addSnapshot(capture, timestamp) {
    if (timestamp == null) {
      throw new ValidationError('timestamp required', { code: 'MISSING_TIMESTAMP', field: 'timestamp' });
    }
    if (!this.snapshots.captures) {
      this.snapshots.captures = [];
    }
    this.snapshots.captures.push(capture);
    this.snapshots.updatedAt = timestamp;
  }

  /**
   * Get session date in YYYY-MM-DD format (derived from sessionId)
   */
  getDate() {
    return this.sessionId.getDate();
  }

  /**
   * Create a session summary (for list views)
   */
  toSummary() {
    return {
      sessionId: this.sessionId.toString(),
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.getDurationMs(),
      rosterCount: this.getRosterCount()
    };
  }

  /**
   * Generate sessionId from a timestamp
   * Format: YYYYMMDDHHmmss (14 digits)
   * @param {Date|string} date - Date object or ISO string (required)
   * @returns {string} - The generated sessionId string
   * @deprecated Use SessionId.generate(date).toString() instead
   */
  static generateSessionId(date) {
    return SessionId.generate(date).toString();
  }

  /**
   * Validate sessionId format (14 digits)
   * @deprecated Use SessionId.isValid(id) instead
   */
  static isValidSessionId(id) {
    return SessionId.isValid(id);
  }

  /**
   * Sanitize sessionId (remove non-digits)
   * @deprecated Use SessionId.sanitize(id) instead
   */
  static sanitizeSessionId(id) {
    return SessionId.sanitize(id);
  }
}

export default Session;
