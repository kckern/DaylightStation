/**
 * Session Entity - Represents a fitness session
 *
 * SessionId format: YYYYMMDDHHmmss (14 digits derived from start time)
 * Timeline contains:
 *   - series: { [participantName]: number[] } - heart rate values per second
 *   - events: { timestamp, type, data }[] - discrete events during session
 */

import { ValidationError } from '../../core/errors/index.mjs';
import { SessionId } from '../value-objects/SessionId.mjs';

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
    session = null
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
   * End the session
   * @param {number} endTime - End timestamp in milliseconds (required)
   */
  end(endTime) {
    if (endTime == null) {
      throw new ValidationError('endTime required', { code: 'MISSING_END_TIME', field: 'endTime' });
    }
    this.endTime = endTime;
    this.durationMs = this.getDurationMs();
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
   * Serialize to plain object (for persistence)
   */
  toJSON() {
    const hasV3Session = !!this.session;
    const hasV3Participants = Object.keys(this.participants).length > 0;

    const result = {
      version: this.version,
      sessionId: this.sessionId.toString()
    };

    // v3: session block at top with human-readable times
    if (hasV3Session) result.session = this.session;

    // Timezone (needed for parsing readable timestamps on read)
    if (this.timezone) result.timezone = this.timezone;

    // v3: participants is canonical; roster is reconstructed on read
    if (hasV3Participants) {
      result.participants = this.participants;
    }

    // Legacy root-level fields — only include when no v3 session block
    // (v3 derives these from session.start/end/duration_seconds and participants)
    if (!hasV3Session) {
      result.startTime = this.startTime;
      result.endTime = this.endTime;
      result.durationMs = this.durationMs;
    }
    if (!hasV3Participants) {
      result.roster = this.roster;
    }

    // Timeline data
    result.timeline = this.timeline;

    // Events at root level (v3) — only when timeline.events is absent
    if (this.events.length > 0 && !(this.timeline?.events?.length > 0)) {
      result.events = this.events;
    }

    // Treasure box (v3 gamification)
    if (this.treasureBox) result.treasureBox = this.treasureBox;

    // Entities (participation segments)
    if (this.entities.length > 0) result.entities = this.entities;

    // Snapshots — only include if non-empty
    const hasSnapshots = this.snapshots &&
      (Array.isArray(this.snapshots.captures) && this.snapshots.captures.length > 0 ||
       this.snapshots.updatedAt != null);
    if (hasSnapshots) result.snapshots = this.snapshots;

    // Metadata — only include if non-empty
    if (this.metadata && Object.keys(this.metadata).length > 0) result.metadata = this.metadata;

    return result;
  }

  /**
   * Create from plain object (from persistence)
   */
  static fromJSON(data) {
    // Handle both sessionId and legacy 'id' field
    const sessionId = data.sessionId || data.id;
    return new Session({
      ...data,
      sessionId
    });
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
