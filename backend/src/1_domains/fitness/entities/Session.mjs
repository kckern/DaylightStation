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
    metadata = {}
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
    return {
      sessionId: this.sessionId.toString(),
      startTime: this.startTime,
      endTime: this.endTime,
      durationMs: this.durationMs,
      timezone: this.timezone,
      roster: this.roster,
      timeline: this.timeline,
      snapshots: this.snapshots,
      metadata: this.metadata
    };
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
