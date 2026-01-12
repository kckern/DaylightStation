/**
 * Session Entity - Represents a fitness session
 *
 * SessionId format: YYYYMMDDHHmmss (14 digits derived from start time)
 * Timeline contains:
 *   - series: { [participantName]: number[] } - heart rate values per second
 *   - events: { timestamp, type, data }[] - discrete events during session
 */

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
    this.sessionId = sessionId;
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
   */
  end(endTime = Date.now()) {
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
   */
  addEvent(type, data = {}) {
    this.timeline.events.push({
      timestamp: Date.now(),
      type,
      ...data
    });
  }

  /**
   * Add a snapshot/screenshot
   */
  addSnapshot(capture) {
    if (!this.snapshots.captures) {
      this.snapshots.captures = [];
    }
    this.snapshots.captures.push(capture);
    this.snapshots.updatedAt = Date.now();
  }

  /**
   * Get session date in YYYY-MM-DD format (derived from sessionId)
   */
  getDate() {
    if (!this.sessionId || this.sessionId.length < 8) return null;
    return `${this.sessionId.slice(0, 4)}-${this.sessionId.slice(4, 6)}-${this.sessionId.slice(6, 8)}`;
  }

  /**
   * Create a session summary (for list views)
   */
  toSummary() {
    return {
      sessionId: this.sessionId,
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
      sessionId: this.sessionId,
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
   */
  static generateSessionId(date = new Date()) {
    const d = typeof date === 'string' ? new Date(date) : date;
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds())
    ].join('');
  }

  /**
   * Validate sessionId format (14 digits)
   */
  static isValidSessionId(id) {
    if (!id) return false;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14;
  }

  /**
   * Sanitize sessionId (remove non-digits)
   */
  static sanitizeSessionId(id) {
    if (!id) return null;
    const digits = String(id).replace(/\D/g, '');
    return digits.length === 14 ? digits : null;
  }
}

export default Session;
